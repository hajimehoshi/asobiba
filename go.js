// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

import './wasm_exec.js';

(() => {
    function enosys() {
	const err = new Error("not implemented");
	err.code = "ENOSYS";
	return err;
    }

    function absPath(cwd, path) {
        const tokens = [];
        path.split('/').filter(t => {
            return t !== '.' && t.length > 0
        }).forEach(s => {
            if (s === '..') {
                tokens.pop();
                return;
            }
            tokens.push(s);
        });
        let wd = cwd;
        if (wd[wd.length-1] !== '/') {
            wd += '/';
        }
        path = wd + tokens.join('/');
        if (path[path.length-1] === '/' && path !== '/') {
            path = path.substring(0, path.length-1);
        }
        return path;
    }

    class FS {
        constructor(ps) {
            this.files_ = new Map();
            this.fds_ = new Map();
            this.ps_ = ps;
            this.nextFd_ = 1000;

            this.files_.set(this.ps_.cwd(), {
                directory: true,
            });
        }

        get constants() {
            return {
                O_WRONLY: 1 << 0,
                O_RDWR:   1 << 1,
                O_CREAT:  1 << 2,
                O_TRUNC:  1 << 3,
                O_APPEND: 1 << 4,
                O_EXCL:   1 << 5,
            };
        }

        writeSync(fd, buf) {
            if (fd === 1) {
                console.log(new TextDecoder("utf-8").decode(buf));
                return buf.length;
            }
            if (fd === 2) {
                console.warn(new TextDecoder("utf-8").decode(buf));
                return buf.length;
            }

            const handle = this.fds_.get(fd);
            const content = this.files_.get(handle.path).content;
            let finalLength = handle.offset + buf.length;

            // Extend the size if necessary
            let n = content.buffer.length;
            while (n < finalLength) {
                n *= 2;
            }
            if (content.buffer.length !== n) {
                content = new Uint8Array(new ArrayBuffer(n), 0, finalLength).set(content);
            } else {
                content = new Uint8Array(content.buffer, 0, finalLength);
            }

            content.set(buf, handle.offset)

            handle.offset += buf.length;
            this.files_.get(handle.path).content = content;

            return buf.length;
        }

        write(fd, buf, offset, length, position, callback) {
            if (offset !== 0 || length !== buf.length || position !== null) {
                // TOOD: Implement this.
                callback(enosys());
                return;
            }
            const n = this.writeSync(fd, buf);
            callback(null, n);
        }

        chmod(path, mode, callback) {
            callback(null);
        }

	chown(path, uid, gid, callback) {
            callback(null);
        }

	close(fd, callback) {
            this.fds_.delete(fd);
            callback(null);
        }

	fchmod(fd, mode, callback) {
            callback(null);
        }

	fchown(fd, uid, gid, callback) {
            callback(null);
        }

	fstat(fd, callback) {
            this.stat_(path, callback);
        }

	fsync(fd, callback) {
            callback(null);
        }

	ftruncate(fd, length, callback) {
            // TODO: Implement this?
            callback(enosys());
        }

	lchown(path, uid, gid, callback) {
            callback(null);
        }

	link(path, link, callback) {
            callback(null);
        }

	lstat(path, callback) {
            this.stat_(path, callback);
        }

	mkdir(path, perm, callback) {
            // TODO: Implement this?
            callback(enosys());
        }

	open(path, flags, mode, callback) {
            path = absPath(this.ps_.cwd(), path);
            if (!this.files_.has(path)) {
                if (!(flag & this.constants.O_CREAT)) {
                    const err = new Error('no such file');
                    err.code = 'ENOENT';
                    callback(err);
                    return;
                }
                this.files_.set(path, {
                    content:   new Uint8Array(0),
                    directory: false,
                });
            }
            // TODO: Abort is path is a directory.
            if (flags & constants.O_TRUNC) {
                this.files_.set(path, {
                    content:   new Uint8Array(0),
                    directory: false,
                });
            }

            const fd = this.nextFd_;
            this.nextFd_++;
            this.fds_.set(fd, {
                path:   path,
                offset: 0,
            });
            callback(null, fd);
        }

	read(fd, buffer, offset, length, position, callback) {
            const handle = this.fds_.get(fd);
            if (position !== null) {
                handle.offset = position;
            }

            const content = this.files_.get(handle.path).content;
            let n = length;
            if (handle.offset + length > content.length) {
                n = content.length - handle.offset;
            }
            if (n < buffer.length - offset) {
                n = buffer.length - offset
            }

            for (let i = 0; i < n; i++) {
                buffer[offset+i] = content[handle.offset+i];
            }

            handle.offset += n;
            callback(null, n);
        }

	readdir(path, callback) {
            callback(enosys());
        }

	readlink(path, callback) {
            callback(enosys());
        }

	rename(from, to, callback) {
            // TODO: Implement this?
            callback(enosys());
        }

	rmdir(path, callback) {
            // TODO: Implement this?
            callback(enosys());
        }

	stat(path, callback) {
            this.stat_(path, callback);
        }

	symlink(path, link, callback) {
            // TODO: Implement this?
            callback(enosys());
        }

	truncate(path, length, callback) {
            // TODO: Implement this?
            callback(enosys());
        }

	unlink(path, callback) {
            // TODO: Mark the file removed and remove it later.
            callback(null);
        }

	utimes(path, atime, mtime, callback) {
            callback(null);
        }

        stat_(path, callback) {
            path = absPath(this.ps_.cwd(), path);
            if (!this.files_.has(path)) {
                const err = new Error('no such file');
                err.code = 'ENOENT';
                callback(err);
                return;
            }
            let mode = 0;
            const file = this.files_.get(path);
            if (file.directory) {
                mode |= 0x80000000;
            }
            callback(null, {
                mode:    mode,
                dev:     0,
                ino:     0,
                nlink:   0,
                uid:     0,
                gid:     0,
                rdev:    0,
                size:    0,
                blksize: 0,
                blocks:  0,
                atimeMs: 0,
                mtimeMs: 0,
                ctimeMs: 0,
                isDirectory: () => !!(mode & 0x80000000),
            });
        }
    }

    class Process {
        constructor() {
            this.wd_ = '/';
        }

        getuid() { return -1; }
	getgid() { return -1; }
	geteuid() { return -1; }
	getegid() { return -1; }
	getgroups() { throw enosys(); }
	get pid() { return -1; }
	get ppid() { -1; }
	umask() { throw enosys(); }

        cwd() {
            return this.wd_;
        }

	chdir(dir) {
            this.wd_ = absPath(this.wd_, dir);
        }
    }

    const process = new Process();
    const fs = new FS(process);
    window.fs = fs;
    window.process = process;
})();

// Polyfill
if (!WebAssembly.instantiateStreaming) {
    WebAssembly.instantiateStreaming = async (resp, importObject) => {
        const source = await (await resp).arrayBuffer();
        return await WebAssembly.instantiate(source, importObject);
    };
}

export function execGo(argv) {
    return new Promise((resolve, reject) => {
        // Note: go1.14beta1.wasm is created by this command:
        //
        //    cd [go source]/src/cmd/go
        //    GOOS=js GOARCH=wasm go1.14beta1 build -trimpath -o=go1.14beta1.wasm .
        const go = new Go();
        WebAssembly.instantiateStreaming(fetch("go1.14beta1.wasm"), go.importObject).then(result => {
            go.exit = resolve;
            go.argv = go.argv.concat(argv || []);
            // TODO: Pass env?
            go.run(result.instance);
        }).catch(reject);
    })
}
