// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

// +build ignore

package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

var (
	flagTar   = flag.String("tar", "", "tar file of Go binary")
	flagDir   = flag.String("dir", "", "directory of Go binary")
	flagClean = flag.Bool("clean", false, "clears the builts")
)

func main() {
	flag.Parse()
	if *flagTar == "" && *flagDir == "" && *flagClean == false {
		// TODO: This works only on macOS and Linux. Take care about other platforms.
		fmt.Fprintf(os.Stderr, "-tar or -dir must be specified. Download from https://dl.google.com/go/go%s.%s-%s.tar.gz and use it.\n", goversion, runtime.GOOS, runtime.GOARCH)
		os.Exit(1)
	}

	if err := run(); err != nil {
		panic(err)
	}
}

func run() error {
	// Reset GOROOT so that generating Go toolchain will not be affected by Go in GOROOT.
	if err := os.Unsetenv("GOROOT"); err != nil {
		return err
	}

	if err := os.RemoveAll("wasm_exec.js"); err != nil {
		return err
	}
	if err := os.RemoveAll("stdfiles.json.gz"); err != nil {
		return err
	}
	if err := os.RemoveAll("bin"); err != nil {
		return err
	}
	if *flagClean {
		return nil
	}

	tmp, err := ioutil.TempDir("", "playground-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)

	if err := prepareGo(tmp); err != nil {
		return err
	}
	if err := copyWasmExecJs(tmp); err != nil {
		return err
	}
	if err := genStdfiles(tmp); err != nil {
		return err
	}
	// TODO: Generate cache with GOOS=js GOARCH=wasm GOCACHE=/path/to/cache $GOROOT/bin/go build -x std
	// This must be done before replacing files.

	if err := replaceFiles(tmp); err != nil {
		return err
	}
	if err := genBins(tmp); err != nil {
		return err
	}
	return nil
}

const (
	goversion = "1.14beta1"
)

func prepareGo(tmp string) error {
	if *flagDir != "" {
		fmt.Printf("Copying %s\n", *flagDir)
		cmd := exec.Command("cp", "-r", *flagDir, filepath.Join(tmp, "go"))
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return err
		}
		return nil
	}

	const gotarfile = "go.tar.gz"
	fmt.Printf("Copying %s to %s\n", *flagTar, gotarfile)

	in, err := os.Open(*flagTar)
	if err != nil {
		return err
	}
	defer in.Close()

	gotar := filepath.Join(tmp, gotarfile)
	f, err := os.Create(gotar)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, in); err != nil {
		return err
	}

	fmt.Printf("Extracting %s\n", gotarfile)

	cmd := exec.Command("tar", "-xzf", gotarfile)
	cmd.Stderr = os.Stderr
	cmd.Dir = tmp
	if err := cmd.Run(); err != nil {
		return err
	}

	gobin := filepath.Join(tmp, "go", "bin", "go")
	cmd = exec.Command(gobin, "version")
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return err
	}
	fmt.Printf("Checking go version: %s\n", strings.TrimSpace(string(out)))

	return nil
}

func replaceFiles(tmp string) error {
	type replace struct {
		path  string
		clear bool
	}

	// Rewite files in some packages.
	for _, r := range []replace{
		{
			path:  filepath.Join("os", "exec"),
			clear: true,
		},
		{
			path:  filepath.Join("cmd", "go", "internal", "lockedfile", "internal", "filelock"),
			clear: true,
		},
	} {
		path := r.path
		if r.clear {
			if err := os.RemoveAll(filepath.Join(tmp, "go", "src", path)); err != nil {
				return err
			}
			if err := os.Mkdir(filepath.Join(tmp, "go", "src", path), 0777); err != nil {
				return err
			}
		}

		dir, err := os.Open(filepath.Join("go", path))
		if err != nil {
			return err
		}
		fs, err := dir.Readdir(0)
		if err != nil {
			return err
		}
		for _, f := range fs {
			if f.IsDir() {
				continue
			}
			// Check the extension since sometimes there can be backup files with ~.
			if !strings.HasSuffix(f.Name(), ".go") {
				continue
			}

			in, err := os.Open(filepath.Join("go", path, f.Name()))
			if err != nil {
				return err
			}
			defer in.Close()

			if err := os.MkdirAll(filepath.Join(tmp, "go", "src", path), 0755); err != nil {
				return err
			}

			out, err := os.Create(filepath.Join(tmp, "go", "src", path, f.Name()))
			if err != nil {
				return err
			}
			defer out.Close()

			if _, err := io.Copy(out, in); err != nil {
				return err
			}
		}
	}

	return nil
}

func goroot(tmp string) (string, error) {
	gobin := filepath.Join(tmp, "go", "bin", "go")

	cmd := exec.Command(gobin, "env", "GOROOT")
	cmd.Env = append(os.Environ(), "GOOS=js", "GOARCH=wasm")
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func copyWasmExecJs(tmp string) error {
	fmt.Printf("Copying wasm_exec.js\n")

	gr, err := goroot(tmp)
	if err != nil {
		return err
	}

	out, err := os.Create("wasm_exec.js")
	if err != nil {
		return err
	}
	defer out.Close()
	in, err := os.Open(filepath.Join(gr, "misc", "wasm", "wasm_exec.js"))
	if err != nil {
		return err
	}
	defer in.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return nil
}

func stdfiles(tmp string) ([]string, error) {
	gobin := filepath.Join(tmp, "go", "bin", "go")

	cmd := exec.Command(gobin, "list", "-f", "dir: {{.Dir}}\n{{range .GoFiles}}file: {{.}}\n{{end}}{{range .SFiles}}file: {{.}}\n{{end}}{{range .HFiles}}file: {{.}}\n{{end}}", "std")
	cmd.Env = append(os.Environ(), "GOOS=js", "GOARCH=wasm")
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	gr, err := goroot(tmp)
	if err != nil {
		return nil, err
	}

	var files []string
	var dir string
	for _, line := range strings.Split(string(out), "\n") {
		const predir = "dir:"
		const prefile = "file:"
		if strings.HasPrefix(line, predir) {
			dir = strings.TrimSpace(line[len(predir):])
			continue
		}
		if strings.HasPrefix(line, prefile) {
			file := strings.TrimSpace(line[len(prefile):])
			rel, err := filepath.Rel(gr, filepath.Join(dir, file))
			if err != nil {
				return nil, err
			}
			files = append(files, rel)
		}
	}
	return files, nil
}

func genStdfiles(tmp string) error {
	fmt.Printf("Generating stdfiles.json.gz\n")

	// Add $GOROOT/src
	fs, err := stdfiles(tmp)
	if err != nil {
		return err
	}
	gr, err := goroot(tmp)
	if err != nil {
		return err
	}
	contents := map[string]string{}
	for _, f := range fs {
		c, err := ioutil.ReadFile(filepath.Join(gr, f))
		if err != nil {
			return err
		}
		contents[f] = string(c)
	}

	// Add $GOROOT/pkg/include
	if err := filepath.Walk(filepath.Join(gr, "pkg", "include"), func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(gr, path)
		if err != nil {
			return err
		}

		c, err := ioutil.ReadFile(path)
		if err != nil {
			return err
		}

		contents[rel] = string(c)
		return nil
	}); err != nil {
		return err
	}

	f, err := os.Create("stdfiles.json.gz")
	if err != nil {
		return err
	}
	defer f.Close()

	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(contents); err != nil {
		return err
	}

	w := gzip.NewWriter(f)
	defer w.Close()
	if _, err := io.Copy(w, &buf); err != nil {
		return err
	}
	if err := w.Flush(); err != nil {
		return err
	}

	return nil
}

func genBins(tmp string) error {
	gobin := filepath.Join(tmp, "go", "bin", "go")

	type bin struct {
		name     string
		compress bool
	}

	for _, b := range []bin{
		{
			name:     "go",
			compress: true,
		},
		{
			name:     "asm",
			compress: true,
		},
		{
			name:     "compile",
			compress: true,
		},
		{
			name:     "link",
			compress: true,
		},
	} {
		name := b.name + goversion + ".wasm"
		path := "cmd/" + b.name
		fmt.Printf("Generating %s", filepath.Join("bin", name))
		if b.compress {
			fmt.Printf(".gz")
		}
		fmt.Printf("\n")
		cmd := exec.Command(gobin, "build", "-trimpath", "-o="+filepath.Join("bin", name), path)
		cmd.Env = append(os.Environ(), "GOOS=js", "GOARCH=wasm")
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return err
		}

		if !b.compress {
			continue
		}

		in, err := os.Open(filepath.Join("bin", name))
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(filepath.Join("bin", name+".gz"))
		if err != nil {
			return err
		}
		defer out.Close()

		w := gzip.NewWriter(out)
		defer w.Close()
		if _, err := io.Copy(w, in); err != nil {
			return err
		}
		if err := w.Flush(); err != nil {
			return err
		}

		if err := os.Remove(filepath.Join("bin", name)); err != nil {
			return err
		}
	}
	return nil
}
