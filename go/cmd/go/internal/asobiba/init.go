// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

package asobiba

import (
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"syscall/js"
)

var (
	jsFS         = js.Global().Get("fs")
	jsUint8Array = js.Global().Get("Uint8Array")
)

func init() {
	if err := initialize(); err != nil {
		panic(err)
	}
}

func initialize() error {
	res, err := http.Get("./stdfiles.json.gz")
	if err != nil {
		return err
	}
	defer res.Body.Close()

	r, err := gzip.NewReader(res.Body)
	if err != nil {
		return err
	}
	defer r.Close()

	d := json.NewDecoder(r)
	var files map[string]string
	if err := d.Decode(&files); err != nil {
		return err
	}

	const goroot = "/go"
	for name, content := range files {
		decoded, err := base64.StdEncoding.DecodeString(content)
		if err != nil {
			return err
		}

		path := goroot + "/" + name
		jsFS.Call("mkdirp_", path[:strings.LastIndex(path, "/")])

		u8 := jsUint8Array.New(len(decoded))
		js.CopyBytesToJS(u8, decoded)
		jsFS.Get("files_").Call("set", path, map[string]interface{}{
			"content": u8,
		})
	}

	return nil
}
