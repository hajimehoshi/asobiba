// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

// The original license:
//
// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package exec is a mock implementation of os/exec for the playground.
package exec

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"syscall"
	"syscall/js"
)

var ErrNotFound = errors.New("executable file not found in $PATH")

func LookPath(file string) (string, error) {
	return "", &Error{file, ErrNotFound}
}

type Cmd struct {
	Path         string
	Args         []string
	Env          []string
	Dir          string
	Stdin        io.Reader
	Stdout       io.Writer
	Stderr       io.Writer
	ExtraFiles   []*os.File
	SysProcAttr  *syscall.SysProcAttr
	Process      *os.Process
	ProcessState *os.ProcessState
}

func Command(name string, arg ...string) *Cmd {
	return &Cmd{
		Path: name,
		Args: append([]string{name}, arg...),
	}
}

func CommandContext(ctx context.Context, name string, arg ...string) *Cmd {
	panic("exec: CommandContext is not implemented")
}

func (c *Cmd) CombinedOutput() ([]byte, error) {
	panic("exec: (*Cmd).CombinedOutput is not implemented")
}

func (c *Cmd) Output() ([]byte, error) {
	panic("exec: (*Cmd).Output is not implemented")
}

func (c *Cmd) Run() error {
	if c.Dir != "" {
		panic("exec: Dir is not supported")
	}
	if c.Stdin != nil {
		panic("exec: Stdin is not supported")
	}
	if len(c.ExtraFiles) > 0 {
		panic("exec: ExtraFiles is not supported")
	}
	if c.SysProcAttr != nil {
		panic("exec: SysProcAttr is not supported")
	}
	if c.Process != nil {
		panic("exec: Process is not supported")
	}
	if c.ProcessState != nil {
		panic("exec: ProcessState is not supported")
	}

	var args []interface{}
	for _, arg := range c.Args[1:] {
		args = append(args, arg)
	}

	env := map[string]interface{}{}
	for _, e := range c.Env {
		n := strings.Index(e, "=")
		if n < 0 {
			return &Error{c.Path, fmt.Errorf("invalid env: %v", e)}
		}
		env[e[:n]] = e[n+1:]
	}

	ch := make(chan error, 1)
	then := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		close(ch)
		return nil
	})
	defer then.Release()
	catch := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		ch <- &Error{c.Path, fmt.Errorf("js error: %v", args[0])}
		close(ch)
		return nil
	})
	defer catch.Release()

	stdout := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		buf := make([]byte, args[0].Get("byteLength").Int())
		js.CopyBytesToGo(buf, args[0])
		if _, err := c.Stdout.Write(buf); err != nil {
			return err.Error()
		}
		return nil
	})
	defer stdout.Release()
	stderr := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		buf := make([]byte, args[0].Get("byteLength").Int())
		js.CopyBytesToGo(buf, args[0])
		if _, err := c.Stderr.Write(buf); err != nil {
			return err.Error()
		}
		return nil
	})
	defer stderr.Release()

	js.Global().Get("_goInternal").Call("execCommand", c.Path, args, env, stdout, stderr).Call("then", then).Call("catch", catch)
	return <-ch
}

func (c *Cmd) Start() error {
	panic("exec: (*Cmd).Start is not implemented")
}

func (c *Cmd) StderrPipe() (io.ReadCloser, error) {
	panic("exec: (*Cmd).StderrPipe is not implemented")
}

func (c *Cmd) StdinPipe() (io.WriteCloser, error) {
	panic("exec: (*Cmd).StdinPipe is not implemented")
}

func (c *Cmd) StdoutPipe() (io.ReadCloser, error) {
	panic("exec: (*Cmd).StdoutPipe is not implemented")
}

func (c *Cmd) String() string {
	// report the exact executable path (plus args)
	b := new(strings.Builder)
	b.WriteString(c.Path)
	for _, a := range c.Args[1:] {
		b.WriteByte(' ')
		b.WriteString(a)
	}
	return b.String()
}

func (c *Cmd) Wait() error {
	panic("exec: (*Cmd).Wait is not implemented")
}

type Error struct {
	Name string
	Err  error
}

func (e *Error) Error() string {
	return "exec: " + strconv.Quote(e.Name) + ": " + e.Err.Error()
}

func (e *Error) Unwrap() error {
	return e.Err
}

type ExitError struct {
	*os.ProcessState
	Stderr []byte
}

func (e *ExitError) Error() string {
	return e.ProcessState.String()
}
