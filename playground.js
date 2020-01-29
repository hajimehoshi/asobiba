// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

class Go {
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

    run(source) {
        return new Promise((resolve, reject) => {
            const worker = new Worker('./go.js');
            worker.addEventListener('message', this.onMessageFromWorker_(resolve, reject));
            worker.postMessage({
                command: ['go', 'run', '-x', 'main.go'],
                files: {
                    'main.go': source,
                }
            });
        })
    }

    onMessageFromWorker_(resolve, reject) {
        return (e) => {
            let data = e.data;
            switch (data.type) {
            case 'stdout':
                this.stdoutBuf_ += this.stdoutDecoder_.decode(data.body);
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
                break;
            case 'stderr':
                this.stderrBuf_ += this.stderrDecoder_.decode(data.body);
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
                break;
            case 'exit':
                resolve();
                break;
            case 'debug':
                const a = document.createElement('a');
                const blob = new Blob([data.body], {type: 'application/octet-stream'});
                a.href = URL.createObjectURL(blob);
                a.setAttribute('download', data.name);
                a.click();
                break;
            default:
                console.error(`not implemented ${data.type}`);
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
        const textArea = document.getElementById('source');
        const src = textArea.value;
        const data = new TextEncoder().encode(src);
        const go = new Go();
        await go.run(data);
        runButton.disabled = false;
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
