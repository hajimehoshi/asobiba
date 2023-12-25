// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

//go:build ignore

package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

var (
	httpAddr = flag.String("http", ":8000", "HTTP address")
)

var rootPath = ""

func init() {
	flag.Parse()
	dir := flag.Arg(0)
	if dir == "" {
		dir = "."
	}
	rootPath = dir
}

type handler struct{}

func (handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(rootPath, r.URL.Path[1:])
	f, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			w.WriteHeader(http.StatusNotFound)
			http.ServeFile(w, r, filepath.Join(rootPath, "404.html"))
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if f.IsDir() {
		path = filepath.Join(path, "index.html")
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				w.WriteHeader(http.StatusNotFound)
				http.ServeFile(w, r, filepath.Join(rootPath, "404.html"))
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	http.ServeFile(w, r, path)
}

func main() {
	http.Handle("/", handler{})
	log.Fatal(http.ListenAndServe(*httpAddr, nil))
}
