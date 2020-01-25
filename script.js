// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

import { execGo } from './go.js';

class EbitenPlayer extends HTMLElement {
    constructor() {
        super();

        const recv = () => {
            window.addEventListener('message', (e) => {
                document.getElementById('message').textContent = e.data;
            });
        }

        const playerSrc = `<style>
body {
  color: #fff;
  background-color: #000;
}
</style>
<script>(${recv.toString()})();</script>
<p id="message"></p>`

        const iframe = document.createElement('iframe');
        iframe.allow = 'autoplay';
        iframe.src = `data:text/html;charset=utf-8;base64,${btoa(playerSrc)}`;
        iframe.style.borderStyle = 'none';
        this.iframe_ = iframe;

        this.style.display = 'inline-block';

        const shadowRoot = this.attachShadow({mode: 'closed'});
        shadowRoot.appendChild(iframe);

        new Promise(resolve => {
            this.iframe_.addEventListener('load', () => {
                resolve();
            });
        }).then(() => {
            this.exec_();
        })
    }

    attributeChangedCallback(attrName, oldVal, newVal) {
        if (attrName !== 'src') {
            return;
        }
        this.exec_();
    }

    exec_() {
        const src = this.getAttribute('src');
        this.iframe_.contentWindow.postMessage(src, '*');

        // TODO: Parse src as a Go file and execute this.

        execGo(["help"]).then(code => {
            console.warn("exit code:", code);
        }).catch(e => {
            console.error(e);
        });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.customElements.define('ebiten-player', EbitenPlayer);
});
