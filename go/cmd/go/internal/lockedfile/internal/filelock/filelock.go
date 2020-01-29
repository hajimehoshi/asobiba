// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

// The original license:
//
// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package filelock is a mock implementation of cmd/go/internal/lockedfile/internal/filelock for the playground.
package filelock

import (
	"errors"
	"os"
)

var ErrNotSupported = errors.New("operation not supported")

func IsNotSupported(err error) bool {
	return false
}

func Lock(f File) error {
	// TODO: Is the empty implementation actually fine?
	return nil
}

func RLock(f File) error {
	return nil
}

func Unlock(f File) error {
	return nil
}

type File interface {
    Name() string
    Fd() uintptr
    Stat() (os.FileInfo, error)
}
