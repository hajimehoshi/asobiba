// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

export class Base64 {
    static btoa(str) {
        const u16 = Uint16Array.from(str, c => c.charCodeAt(0));
        const u8 = new Uint8Array(u16.buffer);
        return btoa(String.fromCharCode.apply(null, u8));
    }

    static atob(str) {
        const u8 = Uint8Array.from(atob(str), c => c.charCodeAt(0));
        const u16 = new Uint16Array(u8.buffer);
	return String.fromCharCode.apply(null, u16);
    }
}
