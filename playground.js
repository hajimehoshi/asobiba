// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

import './wasm_exec.js';
import './pako.min.js';
import './codemirror.min.js';
import './codemirror_mode_go.min.js';

class Printer {
    constructor() {
        this.stdoutBuf_ = '';
        this.stdoutDecoder_ = new TextDecoder('utf-8');
        this.stderrBuf_ = '';
        this.stderrDecoder_ = new TextDecoder('utf-8');
        this.infoBuf_ = '';
        this.infoDecoder_ = new TextDecoder('utf-8');

        this.output_ = document.getElementById('output');
        this.clearOutput_();
    }

    clearOutput_() {
        while (this.output_.firstChild) {
            this.output_.firstChild.remove();
        }
    }

    write(buf, type, subprocess) {
        let buffer = null;
        let decoder = null;
        switch (type) {
        case 'stdout':
            buffer = this.stdoutBuf_;
            decoder = this.stdoutDecoder_;
            break;
        case 'stderr':
            buffer = this.stderrBuf_;
            decoder = this.stderrDecoder_;
            break;
        case 'info':
            buffer = this.infoBuf_;
            decoder = this.infoDecoder_;
            break;
        default:
            throw new Error(`unknown output type: ${type}`);
        }

        buffer += decoder.decode(buf);
        for (;;) {
            const n = buffer.indexOf('\n');
            if (n < 0) {
                break;
            }
            const span = document.createElement('span');
            span.classList.add(type);
            if (subprocess) {
                span.classList.add('subprocess');
            }
            let line = buffer.substring(0, n+1);
            const clearPage = line.lastIndexOf('\x0c');
            if (clearPage >= 0) {
                this.clearOutput_();
                line = line.substring(clearPage+1);
            }
            span.textContent = line;

            const scrollable = this.output_.parentElement;
            const tracking = scrollable.scrollHeight - scrollable.scrollTop === scrollable.clientHeight;
            this.output_.appendChild(span);
            if (tracking) {
                scrollable.scroll(0, scrollable.scrollHeight);
            }

            buffer = buffer.substring(n+1);
        }

        switch (type) {
        case 'stdout':
            this.stdoutBuf_ = buffer;
            break;
        case 'stderr':
            this.stderrBuf_ = buffer;
            break;
        case 'info':
            this.infoBuf_ = buffer;
            break;
        default:
            throw new Error(`unknown output type: ${type}`);
        }
    }
}

class GoCompiler {
    constructor(printer) {
        this.printer_ = printer;
    }

    build(source) {
        return new Promise((resolve, reject) => {
            const defaultGoMod = new TextEncoder().encode(`module asobiba`);

            const worker = new Worker('./go.js');
            worker.addEventListener('message', this.onMessageFromWorker_(worker, source, resolve, reject));
            worker.addEventListener('error', reject);
            worker.postMessage({
                command: ['go', 'mod', 'tidy'],
                files: {
                    'main.go': source,
                    'go.mod':  defaultGoMod,
                },
                outputFiles: ['go.mod'],
            })
        })
    }

    onMessageFromWorker_(worker, source, resolve, reject) {
        return (e) => {
            let data = e.data;
            switch (data.type) {
            case 'stdout':
                this.printer_.write(data.body, 'stdout', true);
                break;
            case 'stderr':
                this.printer_.write(data.body, 'stderr', true);
                break;
            case 'info':
                this.printer_.write(data.body, 'info', true);
                break;
            case 'commandDone':
                const code = e.data.code;
                if (code) {
                    worker.terminate();
                    reject(code);
                    break;
                }
                for (let filename in e.data.outputFiles) {
                    switch (filename) {
                    case 'main.wasm':
                        resolve(e.data.outputFiles[filename]);
                        break;
                    case 'go.mod':
                        const goMod = e.data.outputFiles[filename];
                        worker.postMessage({
                            command: ['go', 'build', '-x', '-o', 'main.wasm', 'main.go'],
                            files: {
                                'main.go': source,
                                'go.mod':  goMod,
                            },
                            outputFiles: ['main.wasm'],
                        });
                        break;
                    }
                }
                break;
            case 'download':
                const a = document.createElement('a');
                const blob = new Blob([data.body], {type: 'application/octet-stream'});
                a.href = URL.createObjectURL(blob);
                a.setAttribute('download', data.name);
                a.click();
                break;
            default:
                throw new Error(`not implemented ${data.type}`);
                break;
            }
        };
    }
}

window.addEventListener('DOMContentLoaded', async (e) => {
    updateCSS();

    let source = `package main

import "fmt"

func main() {
  fmt.Println("Hello, World!")
}`;

    const url = new URL(window.location);
    const search = url.searchParams;
    if (search.has('src')) {
        try {
            const compressed = search.get('src');
            const src = pako.inflate(atob(compressed));
            source = new TextDecoder('utf-8').decode(src);
        } catch (e) {
            // Incorrect input.
            console.error(e);
        }
    }
    const editor = CodeMirror(document.getElementById('source'), {
        mode: 'go',
        lineNumbers: true,
        lineWrapping: true,
        autofocus: true,
        styleActiveLine: true,
        value: source,
    });

    const runButton = document.getElementById('run');
    runButton.addEventListener('click', async () => {
        runButton.disabled = true;
        const printer = new Printer();

        // TODO: Split the source into multiple files. See https://play.golang.org/p/KLZR7NlVZNX
        try {
            const src = editor.getValue();
            const data = new TextEncoder().encode(src);
            const gc = new GoCompiler(printer);
            let wasm = null;
            try {
                wasm = await gc.build(data);
            } catch (code) {
                printer.write(new TextEncoder('utf-8').encode(`exit code: ${code}\n`), 'stderr');
            }
            const go = new Go();
            go.exit = (code) => {
                if (code !== 0) {
                    printer.write(new TextEncoder('utf-8').encode(`exit code: ${code}\n`), 'stderr');
                }
            }

            // Rewrite stdout/stderr.
            globalThis.fs.write = (fd, buf, offset, length, position, callback) => {
                if (offset !== 0 || length !== buf.length || position !== null) {
		    callback(enosys());
		    return;
		}
                switch (fd) {
                case 1:
                    printer.write(buf, 'stdout');
                    callback(null, buf.length);
                    return;
                case 2:
                    printer.write(buf, 'stderr');
                    callback(null, buf.length);
                    return;
                }
                callback(enosys());
            }

            if (!wasm) {
                return;
            }
            try {
                const instance = (await WebAssembly.instantiate(wasm, go.importObject)).instance;
                await go.run(instance);
            } catch (e) {
                // e.g., If the source is not a main package, instantiation fails.
                printer.write(new TextEncoder('utf-8').encode(e.message + '\n'), 'stderr');
            }
        } finally {
            runButton.disabled = false;
        }
    });

    const shareButton = document.getElementById('share');
    shareButton.addEventListener('click', async () => {
        const src = editor.getValue();
        const compressed = pako.deflate(src);
        const b64 = btoa(String.fromCharCode(...compressed));
        const url = new URL(window.location);
        const search = url.searchParams;
        search.set('src', b64);
        url.search = search.toString();
        history.replaceState(undefined, undefined, url);
    });

    document.getElementById('loading').style.display = 'none';
});

window.addEventListener('resize', (e) => {
    updateCSS();
});

function updateCSS() {
    // Trick to override vh unit for mobile platforms.
    // See https://css-tricks.com/the-trick-to-viewport-units-on-mobile/
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}
