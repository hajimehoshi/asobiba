// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

window.addEventListener('message', (e) => {
    // TODO: Split the source into multiple files. See https://play.golang.org/p/KLZR7NlVZNX
    const src = e.data;

    // Just demo
    const pre = document.createElement('pre');
    pre.textContent = src
    document.body.appendChild(pre);

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
