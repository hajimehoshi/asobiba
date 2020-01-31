// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

import './wasm_exec.js';

class GoCompiler {
    constructor() {
        this.stdoutBuf_ = '';
        this.stdoutDecoder_ = new TextDecoder('utf-8');
        this.stderrBuf_ = '';
        this.stderrDecoder_ = new TextDecoder('utf-8');

        this.output_ = document.getElementById('output');
        while (this.output_.firstChild) {
            this.output_.firstChild.remove();
        }
    }

    build(source) {
        return new Promise((resolve, reject) => {
            const defaultGoMod = new TextEncoder().encode(`module asobiba`);

            const worker = new Worker('./go.js');
            worker.addEventListener('message', this.onMessageFromWorker_(worker, resolve, reject));
            worker.addEventListener('error', reject);
            worker.postMessage({
                command: ['go', 'build', '-x', '-o', 'main.wasm', 'main.go'],
                files: {
                    'main.go': source,
                    'go.mod':  defaultGoMod,
                },
                outputFiles: ['main.wasm'],
            });
        })
    }

    writeToStdout(buf) {
        this.stdoutBuf_ += this.stdoutDecoder_.decode(buf);
        for (;;) {
            const n = this.stdoutBuf_.indexOf('\n');
            if (n < 0) {
                break;
            }
            const span = document.createElement('span');
            span.classList.add('stdout');
            span.textContent = this.stdoutBuf_.substring(0, n+1);

            const scrollable = this.output_.parentElement;
            const tracking = scrollable.scrollHeight - scrollable.scrollTop === scrollable.clientHeight;
            this.output_.appendChild(span);
            if (tracking) {
                scrollable.scroll(0, scrollable.scrollHeight);
            }

            this.stdoutBuf_ = this.stdoutBuf_.substring(n+1);
        }
    }

    writeToStderr(buf) {
        this.stderrBuf_ += this.stderrDecoder_.decode(buf);
        for (;;) {
            const n = this.stderrBuf_.indexOf('\n');
            if (n < 0) {
                break;
            }
            const span = document.createElement('span');
            span.classList.add('stderr');
            span.textContent = this.stderrBuf_.substring(0, n+1);

            const scrollable = this.output_.parentElement;
            const tracking = scrollable.scrollHeight - scrollable.scrollTop === scrollable.clientHeight;
            this.output_.appendChild(span);
            if (tracking) {
                scrollable.scroll(0, scrollable.scrollHeight);
            }

            this.stderrBuf_ = this.stderrBuf_.substring(n+1);
        }
    }

    onMessageFromWorker_(worker, resolve, reject) {
        return (e) => {
            let data = e.data;
            switch (data.type) {
            case 'stdout':
                this.writeToStdout(data.body);
                break;
            case 'stderr':
                this.writeToStderr(data.body);
                break;
            case 'outputFile':
                if (e.data.name === 'main.wasm') {
                    this.result_ = e.data.body;
                }
                break;
            case 'exit':
                worker.terminate();
                const code = e.data.code;
                if (code === 0) {
                    resolve(this.result_);
                } else {
                    reject(code);
                }
                break;
            case 'debug':
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

window.addEventListener('DOMContentLoaded', (e) => {
    updateCSS();

    const defaultSource = `package main

import "fmt"

func main() {
  fmt.Println("Hello, World!")
}`;

    const textArea = document.getElementById('source');
    if (!textArea.value) {
        textArea.value = defaultSource;
    }

    const runButton = document.getElementById('run');
    runButton.addEventListener('click', async () => {
        runButton.disabled = true;

        // TODO: Split the source into multiple files. See https://play.golang.org/p/KLZR7NlVZNX
        try {
            const textArea = document.getElementById('source');
            const src = textArea.value;
            const data = new TextEncoder().encode(src);
            const gc = new GoCompiler();
            let wasm = null;
            try {
                wasm = await gc.build(data);
            } catch (code) {
                gc.writeToStderr(new TextEncoder('utf-8').encode(`exit code: ${code}\n`));
            }
            const go = new Go();
            go.exit = (code) => {
                if (code !== 0) {
                    gc.writeToStderr(new TextEncoder('utf-8').encode(`exit code: ${code}\n`));
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
                    gc.writeToStdout(buf);
                    callback(null, buf.length);
                    return;
                case 2:
                    gc.writeToStderr(buf);
                    callback(null, buf.length);
                    return;
                }
                callback(enosys());
            }

            const instance = (await WebAssembly.instantiate(wasm, go.importObject)).instance;
            await go.run(instance);
        } finally {
            runButton.disabled = false;
        }
    });
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
