// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

window.addEventListener('DOMContentLoaded', (e) => {
    updateCSS();

    const defaultSource = `package main

func main() {
  println("Hello, World!")
}`;

    const textArea = document.getElementById('source');
    textArea.textContent = defaultSource;

    const runButton = document.getElementById('run');
    runButton.addEventListener('click', () => {
        runButton.disabled = true;

        // TODO: Split the source into multiple files. See https://play.golang.org/p/KLZR7NlVZNX
        const textArea = document.getElementById('source');
        const src = textArea.textContent;

        const data = new TextEncoder().encode(src);
        const worker = new Worker('./go.js');
        worker.addEventListener('message', e => {
            // TODO: Implement stdout/stderr.
            let data = e.data;
            switch (data.type) {
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
        });
        worker.postMessage({
            command: ['go', 'run', '-x', 'main.go'],
            files: {
                'main.go': data,
            }
        });
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
