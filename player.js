// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

window.addEventListener('message', (e) => {
    // TODO: Split the source into multiple files. See https://play.golang.org/p/KLZR7NlVZNX
    const src = e.data;
    const data = new TextEncoder().encode(src);

    const worker = new Worker('./go.js');
    worker.addEventListener('message', e => {
        // TODO: Implement this.
        console.log(e);
    });
    worker.postMessage({
        command: ['go', 'build', '-x', 'main.go'],
        files: {
            'main.go': data,
        }
    });
});
