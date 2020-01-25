// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

class EbitenPlayer extends HTMLElement {
    constructor() {
        super();

        const iframe = document.createElement('iframe');
        iframe.allow = 'autoplay';
        iframe.src = './player.html';
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
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.customElements.define('ebiten-player', EbitenPlayer);
});
