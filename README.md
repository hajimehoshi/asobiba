# Asobiba (遊び場)

Asobiba is an experimental Go playground with Go toolchain in WebAssembly.

This is still work in progress.

## How to run on your local machine

1. `go run gen.go -tar [tar file for Go]`. This works only on Linux or macOS so far. The URL for the tar file is shown when you run `go run gen.go` without flags.
2. `go run server.go`
3. Open `http://localhost:8000/`

## Dependencies

* [Go](https://golang.org/) (BSD-3-Clause)
* [normalize.css](https://github.com/necolas/normalize.css) (MIT)
* [pako](https://github.com/nodeca/pako) (MIT)
