// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

import { execGo } from './go.js';

window.addEventListener('message', (e) => {
    // TODO: Split the source into multiple files. See https://play.golang.org/p/KLZR7NlVZNX
    const src = e.data;
    const data = new TextEncoder().encode(src);
    execGo(['build', 'main.go'], {
        'main.go': data,
    }).then(code => {
        if (code !== 0) {
            console.warn('exit code:', code);
        } else {
            console.log('exit code:', code);
        }
    }).catch(e => {
        console.error(e);
    });
});
