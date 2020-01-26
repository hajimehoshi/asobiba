// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package exec is a mock implementation of os/exec for the playground.
package exec

import (
	"context"
	"errors"
	"io"
	"os"
	"strconv"
	"syscall"
)

var ErrNotFound = errors.New("executable file not found in $PATH")

func LookPath(file string) (string, error) {
	panic("exec: LookPath is not implemented")
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
	panic("exec: (*Cmd).Run is not implemented")
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
	panic("exec: (*Cmd).String is not implemented")
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
