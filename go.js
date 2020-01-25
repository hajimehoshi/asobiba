// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

import './wasm_exec.js';

(() => {
    const statModes = {
        S_IFMT:   0o170000, // bit mask for the file type bit fields
        S_IFSOCK: 0o140000, // socket
        S_IFLNK:  0o120000, // symbolic link
        S_IFREG:  0o100000, // regular file
        S_IFBLK:  0o060000, // block device
        S_IFDIR:  0o040000, // directory
        S_IFCHR:  0o020000, // character device
        S_IFIFO:  0o010000, // FIFO
        S_ISUID:  0o004000, // set UID bit
        S_ISGID:  0o002000, // set-group-ID bit (see below)
        S_ISVTX:  0o001000, // sticky bit (see below)
        S_IRWXU:  0o0700,   // mask for file owner permissions
        S_IRUSR:  0o0400,   // owner has read permission
        S_IWUSR:  0o0200,   // owner has write permission
        S_IXUSR:  0o0100,   // owner has execute permission
        S_IRWXG:  0o0070,   // mask for group permissions
        S_IRGRP:  0o0040,   // group has read permission
        S_IWGRP:  0o0020,   // group has write permission
        S_IXGRP:  0o0010,   // group has execute permission
        S_IRWXO:  0o0007,   // mask for permissions for others (not in group)
        S_IROTH:  0o0004,   // others have read permission
        S_IWOTH:  0o0002,   // others have write permission
        S_IXOTH:  0o0001,   // others have execute permission
    };

    function enosys() {
	const err = new Error('not implemented');
	err.code = 'ENOSYS';
	return err;
    }

    function absPath(cwd, path) {
        if (path[0] === '/') {
            return path;
        }

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

            this.files_.set('/', {
                directory: true,
            });
            this.files_.set('/tmp', {
                directory: true,
            });
            this.files_.set('/root', {
                directory: true,
            });
            // GOPATH
            this.files_.set('/root/go', {
                directory: true,
            });
            this.files_.set('/usr', {
                directory: true,
            });
            // GOROOT
            this.files_.set('/usr/go', {
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
            path = absPath(this.ps_.cwd(), path);
            let current = '';
            const tokens = path.split('/');
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                if (current !== '/') {
                    current += '/';
                }
                current += token;
                const file = this.files_.get(current);
                if (!file) {
                    if (i !== tokens.length - 1) {
                        const err = new Error('file exists');
                        err.code = 'EEXIST';
                        callback(err);
                        return;
                    }
                    break;
                }
                if (!file.directory) {
                    const err = new Error('file exists');
                    err.code = 'EEXIST';
                    callback(err);
                    return;
                }
            }
            this.files_.set(path, {
                directory: true,
            });
            callback(null);
        }

	open(path, flags, mode, callback) {
            path = absPath(this.ps_.cwd(), path);
            if (!this.files_.has(path)) {
                if (!(flags & this.constants.O_CREAT)) {
                    const err = new Error('no such file or directory');
                    err.code = 'ENOENT';
                    callback(err);
                    return;
                }
                this.files_.set(path, {
                    content:   new Uint8Array(0),
                    directory: false,
                });
            }
            // TODO: Abort if path is a directory.
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
                const err = new Error('no such file or directory');
                err.code = 'ENOENT';
                callback(err);
                return;
            }
            let mode = 0;
            const file = this.files_.get(path);
            if (file.directory) {
                mode |= statModes.S_IFDIR;
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
                isDirectory: () => !!(mode & statModes.S_IFDIR),
            });
        }
    }

    class Process {
        constructor() {
            this.wd_ = '/root';
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

export function execGo(argv) {
    return new Promise((resolve, reject) => {
        // Polyfill
        let instantiateStreaming = WebAssembly.instantiateStreaming;
        if (!instantiateStreaming) {
            instantiateStreaming = async (resp, importObject) => {
                const source = await (await resp).arrayBuffer();
                return await WebAssembly.instantiate(source, importObject);
            };
        }

        // Note: go1.14beta1.wasm is created by this command:
        //
        //    cd [go source]/src/cmd/go
        //    GOOS=js GOARCH=wasm go1.14beta1 build -trimpath -o=go1.14beta1.wasm .
        const go = new Go();
        instantiateStreaming(fetch("go1.14beta1.wasm"), go.importObject).then(result => {
            go.exit = resolve;
            go.argv = go.argv.concat(argv || []);
            go.env = {
                TMPDIR: '/tmp',
                HOME:   '/root',
                GOROOT: '/usr/go',
            };
            go.run(result.instance);
        }).catch(reject);
    })
}
