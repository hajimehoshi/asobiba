// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

// +build ignore

package main

import (
	"flag"
	"encoding/base64"
	"encoding/json"
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
	flagTar = flag.String("tar", "", "tar file of Go binary")
	flagDir = flag.String("dir", "", "directory of Go binary")
)

func main() {
	flag.Parse()
	if *flagTar == "" && *flagDir == "" {
		// TODO: This works only on macOS and Linux. Take care about other platforms.
		fmt.Fprintf(os.Stderr, "-tar or -dir must be specified. Download from https://dl.google.com/go/go%s.%s-%s.tar.gz and use it.\n", goversion, runtime.GOOS, runtime.GOARCH)
		os.Exit(1)
	}

	if err := run(); err != nil {
		panic(err)
	}
}

func run() error {
	tmp, err := ioutil.TempDir("", "playground-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)

	if err := prepareGo(tmp); err != nil {
		return err
	}
	if err := replaceFiles(tmp); err != nil {
		return err
	}
	if err := genStdfiles(tmp); err != nil {
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
	if (*flagDir != "") {
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
	// Rewite files in os/exec
	if err := os.RemoveAll(filepath.Join(tmp, "go", "src", "os", "exec")); err != nil {
		return err
	}
	if err := os.Mkdir(filepath.Join(tmp, "go", "src", "os", "exec"), 0777); err != nil {
		return err
	}

	dir, err := os.Open(filepath.Join("go", "os", "exec"))
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

		in, err := os.Open(filepath.Join("go", "os", "exec", f.Name()))
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(filepath.Join(tmp, "go", "src", "os", "exec", f.Name()))
		if err != nil {
			return err
		}
		defer out.Close()

		if _, err := io.Copy(out, in); err != nil {
			return err
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
	fmt.Printf("Generating stdfiles.json\n")

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
		contents[f] = base64.StdEncoding.EncodeToString(c)
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
		contents[rel] = base64.StdEncoding.EncodeToString(c)
		return nil
	}); err != nil {
		return err
	}

	f, err := os.Create("stdfiles.json")
	if err != nil {
		return err
	}
	defer f.Close()

	e := json.NewEncoder(f)
	if err := e.Encode(contents); err != nil {
		return err
	}
	return nil
}

func genBins(tmp string) error {
	gobin := filepath.Join(tmp, "go", "bin", "go")

	files := []struct {
		Name string
		Path string
	}{
		{
			Name: "go" + goversion + ".wasm",
			Path: "cmd/go",
		},
		{
			Name: "asm" + goversion + ".wasm",
			Path: "cmd/asm",
		},
		{
			Name: "buildid" + goversion + ".wasm",
			Path: "cmd/buildid",
		},
		{
			Name: "compile" + goversion + ".wasm",
			Path: "cmd/compile",
		},
		{
			Name: "link" + goversion + ".wasm",
			Path: "cmd/link",
		},
		{
			Name: "pack" + goversion + ".wasm",
			Path: "cmd/pack",
		},
	}
	for _, file := range files {
		fmt.Printf("Generating %s\n", file.Name)
		cmd := exec.Command(gobin, "build", "-trimpath", "-o=bin/"+file.Name, file.Path)
		cmd.Env = append(os.Environ(), "GOOS=js", "GOARCH=wasm")
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return err
		}
	}
	return nil
}
