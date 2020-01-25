// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

import { execGo } from './go.js';

window.addEventListener('message', (e) => {
    execGo(["env"], e.data).then(code => {
        console.warn("exit code:", code);
    }).catch(e => {
        console.error(e);
    });
});
