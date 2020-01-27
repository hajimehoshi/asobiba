// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

import './wasm_exec.js';

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

function enosys(name) {
    const err = new Error(`${name} not implemented`);
    err.code = 'ENOSYS';
    return err;
}

class FS {
    static absPath(cwd, path) {
        const removeLastSlash = (path) => {
            if (path[path.length-1] === '/' && path !== '/') {
                path = path.substring(0, path.length-1);
            }
            return path
        }

        if (path[0] === '/') {
            path = removeLastSlash(path);
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
        path = removeLastSlash(path);
        return path;
    }

    static dirs(path) {
        const result = [];
        let current = '';
        const tokens = path.split('/');
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (current !== '/') {
                current += '/';
            }
            current += token;
            result.push(current);
        }
        return result;
    }

    constructor(ps) {
        // TODO: What about using localStorage except for /tmp?
        this.files_ = new Map();
        this.fds_ = new Map();
        this.ps_ = ps;
        this.nextFd_ = 1000;
    }
    
    async initializeFiles() {
        this.files_.set('/', {
            directory: true,
        });
        this.files_.set('/tmp', {
            directory: true,
        });
        this.files_.set('/dev', {
            directory: true,
        });
        this.files_.set('/dev/null', {
            directory: true,
        });
        this.files_.set('/root', {
            directory: true,
        });
        // GOPATH
        this.files_.set('/root/go', {
            directory: true,
        });

        const goroot = '/go'
        this.files_.set(goroot, {
            directory: true,
        });

        // stdlib files
        // TODO: Load them lazily
        const encoder = new TextEncoder();
        let stdfiles = await (await fetch('./stdfiles.json')).json();
        for (const filename of Object.keys(stdfiles)) {
            const fullfn = goroot + '/src/' + filename;
            const dir = fullfn.substring(0, fullfn.lastIndexOf('/'));
            this.mkdirp_(dir);
            this.files_.set(fullfn, {
                content: encoder.encode(atob(stdfiles[filename])),
            });
        }

        // Dummy files for tools
        this.files_.set(goroot + '/pkg', {
            directory: true,
        });
        this.files_.set(goroot + '/pkg/tool', {
            directory: true,
        });
        this.files_.set(goroot + '/pkg/tool/js_wasm', {
            directory: true,
        });
        this.files_.set(goroot + '/pkg/tool/js_wasm/asm', {
            content: new Uint8Array(0),
        });
        this.files_.set(goroot + '/pkg/tool/js_wasm/compile', {
            content: new Uint8Array(0),
        });
        this.files_.set(goroot + '/pkg/tool/js_wasm/link', {
            content: new Uint8Array(0),
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
            globalThis._goInternal.writeToStdout(buf);
            return buf.length;
        }
        if (fd === 2) {
            globalThis._goInternal.writeToStderr(buf);
            return buf.length;
        }

        const handle = this.fds_.get(fd);
        if (handle.path === '/dev/null') {
            return buf.length;
        }
        const file = this.files_.get(handle.path);
        let content = file.content;
        let finalLength = handle.offset + buf.length;

        // Extend the size if necessary
        let n = content.buffer.byteLength;
        if (n === 0) {
            n = 1024;
        }
        while (n < finalLength) {
            n *= 2;
        }
        if (content.buffer.byteLength !== n) {
            const old = content;
            content = new Uint8Array(new ArrayBuffer(n), 0, finalLength);
            content.set(old);
        } else {
            content = new Uint8Array(content.buffer, 0, finalLength);
        }

        content.set(buf, handle.offset)

        handle.offset += buf.length;

        file.content = content;
        this.files_.set(handle.path, file);

        return buf.length;
    }

    write(fd, buf, offset, length, position, callback) {
        if (offset !== 0 || length !== buf.length || position !== null) {
            // TOOD: Implement this.
            callback(enosys('write'));
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
        this.stat_(this.fds_.get(fd).path, callback);
    }

    fsync(fd, callback) {
        callback(null);
    }

    ftruncate(fd, length, callback) {
        const file = this.files_.get(this.fds_.get(fd).path);
        file.content = new Uint8Array(file.content.buffer, 0, length);
        this.files_.set(this.fds_.get(fd).path, file);
        callback(null);
    }

    lchown(path, uid, gid, callback) {
        callback(enosys('lchown'));
    }

    link(path, link, callback) {
        callback(enosys('link'));
    }

    lstat(path, callback) {
        this.stat_(path, callback);
    }

    mkdir(path, perm, callback) {
        path = FS.absPath(this.ps_.cwd(), path);
        const ds = FS.dirs(path);
        for (let i = 0; i < ds.length; i++) {
            const file = this.files_.get(ds[i]);
            if (!file) {
                if (i !== ds.length - 1) {
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
        path = FS.absPath(this.ps_.cwd(), path);
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
        if (flags & this.constants.O_TRUNC) {
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

        const file = this.files_.get(handle.path);
        const content = file.content;
        let n = length;
        if (handle.offset + length > content.byteLength) {
            n = content.byteLength - handle.offset;
        }
        if (n > buffer.length - offset) {
            n = buffer.length - offset;
        }

        for (let i = 0; i < n; i++) {
            buffer[offset+i] = content[handle.offset+i];
        }

        handle.offset += n;
        callback(null, n);
    }

    readdir(path, callback) {
        path = FS.absPath(this.ps_.cwd(), path);
        const filenames = this.filenamesAt_(path);
        callback(null, filenames);
    }

    readlink(path, callback) {
        callback(enosys('readlink'));
    }

    rename(from, to, callback) {
        callback(enosys('rename'));
    }

    rmdir(path, callback) {
        callback(enosys('rmdir'));
    }

    stat(path, callback) {
        this.stat_(path, callback);
    }

    symlink(path, link, callback) {
        // TODO: Implement this?
        callback(enosys('symlink'));
    }

    truncate(path, length, callback) {
        // TODO: Implement this?
        callback(enosys('truncate'));
    }

    unlink(path, callback) {
        // TODO: Mark the file removed and remove it later?
        callback(enosys('unlink'));
    }

    utimes(path, atime, mtime, callback) {
        path = FS.absPath(this.ps_.cwd(), path);
        const file = this.files_.get(path);
        file.atime = atime;
        file.mtime = mtime;
        this.files_.set(path, file);
        callback(null);
    }

    stat_(path, callback) {
        path = FS.absPath(this.ps_.cwd(), path);
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
        } else {
            mode |= statModes.S_IFREG;
        }
        let atime = 0;
        let mtime = 0;
        if (file.atime) {
            atime = file.atime * 1000;
        }
        if (file.mtime) {
            mtime = file.mtime * 1000;
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
            atimeMs: atime,
            mtimeMs: mtime,
            ctimeMs: 0,
            isDirectory: () => !!(mode & statModes.S_IFDIR),
        });
    }

    mkdirp_(dir) {
        for (const path of FS.dirs(dir)) {
            const file = this.files_.get(path);
            if (file) {
                if (file.directory) {
                    continue;
                }
                const err = new Error('file exists');
                err.code = 'EEXIST';
                throw err;
            }
            this.files_.set(path, {
                directory: true,
            });
        }
    }

    filenamesAt_(dir) {
        const result = [];
        for (const key of this.files_.keys()) {
            if (key === dir)
                continue;
            if (!key.startsWith(dir))
                continue;
            const filename = key.substring(dir.length+1);
            if (filename.indexOf('/') >= 0)
                continue;
            result.push(filename);
        }
        return result;
    }

    addWorkingDirectory_(dir, files) {
        this.mkdirp_(dir)
        // TODO: Consider the case when the files include directories.
        for (const filename of Object.keys(files)) {
            const path = dir + '/' + filename;
            this.files_.set(path, {
                content:   files[filename],
                directory: false,
            })
        }
    }

    emptyDirectory_(dir) {
        // TODO: Implement this
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
    getgroups() { throw enosys('getgroups'); }
    get pid() { return -1; }
    get ppid() { -1; }
    umask() { throw enosys('umask'); }

    cwd() {
        return this.wd_;
    }

    chdir(dir) {
        this.wd_ = FS.absPath(this.wd_, dir);
    }
}

class _GoInternal {
    constructor() {
        this.initialized_ = false;
        this.stdout_ = null;
        this.stderr_ = null;
        this.stdoutBuf_ = "";
        this.stderrBuf_ = "";
    }

    async initializeGlobalVariablesIfNeeded() {
        if (this.initialized_) {
            return;
        }
        const process = new Process();
        const fs = new FS(process);
        await fs.initializeFiles();
        globalThis.fs = fs;
        globalThis.process = process;
        this.initialized_ = true;
    }

    writeToStdout(buf) {
        if (this.stdout_) {
            const err = this.stdout_(buf);
            if (err) {
                throw err;
            }
            return;
        }

        this.stdoutBuf_ += new TextDecoder('utf-8').decode(buf);
        for (;;) {
            const n = this.stdoutBuf_.indexOf('\n');
            if (n < 0) {
                break;
            }
            console.log(this.stdoutBuf_.substring(0, n));
            this.stdoutBuf_ = this.stdoutBuf_.substring(n+1);
        }
    }

    writeToStderr(buf) {
        if (this.stderr_) {
            const err = this.stderr_(buf);
            if (err) {
                throw err;
            }
            return;
        }

        this.stderrBuf_ += new TextDecoder('utf-8').decode(buf);
        for (;;) {
            const n = this.stderrBuf_.indexOf('\n');
            if (n < 0) {
                break;
            }
            console.warn(this.stderrBuf_.substring(0, n));
            this.stderrBuf_ = this.stderrBuf_.substring(n+1);
        }
    }

    execCommand(command, argv, env, dir, stdout, stderr) {
        return new Promise((resolve, reject) => {
            // Polyfill
            let instantiateStreaming = WebAssembly.instantiateStreaming;
            if (!instantiateStreaming) {
                instantiateStreaming = async (resp, importObject) => {
                    const source = await (await resp).arrayBuffer();
                    return await WebAssembly.instantiate(source, importObject);
                };
            }

            const origStdout = this.stdout_;
            const origStderr = this.stderr_;
            this.stdout_ = stdout;
            this.stderr_ = stderr;
            const origCwd = globalThis.process.cwd();
            if (dir) {
                globalThis.process.chdir(dir);
            }
            const defer = () => {
                globalThis.process.chdir(origCwd);
                this.stdout_ = origStdout;
                this.stderr_ = origStderr;
            };

            const go = new Go();
            const goversion = '1.14beta1'
            let wasm = ({
                'go':                           `./bin/go${goversion}.wasm`,
                '/go/pkg/tool/js_wasm/asm':     `./bin/asm${goversion}.wasm`,
                '/go/pkg/tool/js_wasm/compile': `./bin/compile${goversion}.wasm`,
                '/go/pkg/tool/js_wasm/link':    `./bin/link${goversion}.wasm`,
            })[command];
            if (!wasm) {
                reject('command not found: ' + command);
                return;
            }
            const commandName = command.split('/').pop()

            const defaultEnv = {
                TMPDIR:      '/tmp',
                HOME:        '/root',
                GOROOT:      '/go',
                GO111MODULE: 'on',
            };

            instantiateStreaming(fetch(wasm), go.importObject).then(result => {
                go.argv = [commandName].concat(argv || []);
                go.env = {...go.env, ...defaultEnv, ...env};
                go.run(result.instance).then(() => {
                    defer();
                    resolve();
                }).catch(e => {
                    defer();
                    console.error("command failed: ", {command, 'argv': go.argv, 'env': go.env});
                    console.error("  files in wd: ", globalThis.fs.filenamesAt_(globalThis.process.cwd()));
                    reject(e);
                });
            });
        })
    }
}

globalThis._goInternal = new _GoInternal();

export function execGo(argv, files) {
    function randomToken() {
        let result = '';
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 12; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    return new Promise(async (resolve, reject) => {
        await globalThis._goInternal.initializeGlobalVariablesIfNeeded();

        // TODO: Detect collision.
        const wd = '/tmp/wd-' + randomToken();
        globalThis.fs.addWorkingDirectory_(wd, files);
        const origCwd = globalThis.process.cwd();
        globalThis.process.chdir(wd);

        globalThis._goInternal.execCommand('go', argv, {}, '', null, null).then(resolve).catch(reject).finally(() => {
            globalThis.fs.emptyDirectory_('/tmp');
        });
    })
}
