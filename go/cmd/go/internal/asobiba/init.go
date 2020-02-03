// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

package asobiba

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"strings"
	"syscall/js"
)

const goversion = "1.14beta1"

var (
	jsFS         = js.Global().Get("fs")
	jsUint8Array = js.Global().Get("Uint8Array")
)

func init() {
	if err := initStdfiles(); err != nil {
		panic(err)
	}
	if err := initWasm(); err != nil {
		panic(err)
	}
}

func decompressHTTPResponse(r io.Reader) (io.Reader, error) {
	r, err := gzip.NewReader(r)
	if err != nil {
		return nil, err
	}

	var magic [2]byte
	if _, err := io.ReadFull(r, magic[:]); err != nil {
		return nil, err
	}
	r = io.MultiReader(bytes.NewReader(magic[:]), r)
	if magic[0] != 0x1f && magic[1] != 0x8b {
		return r, nil
	}

	// A fetched response is decompressed twice on Firefox.
	// See https://bugzilla.mozilla.org/show_bug.cgi?id=610679
	r, err = gzip.NewReader(r)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func initStdfiles() error {
	res, err := http.Get("./stdfiles.json.gz")
	if err != nil {
		return err
	}
	defer res.Body.Close()

	r, err := decompressHTTPResponse(res.Body)
	if err != nil {
		return err
	}

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

func initWasm() error {
	const dir = "/go/pkg/tool/js_wasm"
	jsFS.Call("mkdirp_", dir)

	for _, tool := range []string{"asm", "compile", "link"} {
		res, err := http.Get(fmt.Sprintf("./bin/%s%s.wasm.gz", tool, goversion))
		if err != nil {
			return err
		}
		defer res.Body.Close()

		r, err := decompressHTTPResponse(res.Body)
		if err != nil {
			return err
		}

		bs, err := ioutil.ReadAll(r)
		if err != nil {
			return err
		}

		path := dir + "/" + tool
		u8 := jsUint8Array.New(len(bs))
		js.CopyBytesToJS(u8, bs)
		jsFS.Get("files_").Call("set", path, map[string]interface{}{
			"content": u8,
		})
	}
	return nil
}
