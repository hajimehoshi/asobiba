// Copyright 2020 Hajime Hoshi
// SPDX-License-Identifier: Apache-2.0

function enosys(name) {
    const msg = `${name} not implemented`;
    console.error(msg);
    const err = new Error(msg);
    err.code = 'ENOSYS';
    return err;
}

class Storage {
    constructor() {
        this.storage_ = new Map();
    }

    async has(path) {
        return this.storage_.has(path);
    }

    async get(path) {
        return this.storage_.get(path);
    }

    async set(path, value) {
        this.storage_.set(path, value);
    }

    async delete(path) {
        this.storage_.delete(path);
    }

    async hasChildren(dir) {
        const result = [];
        for (const key of this.storage_.keys()) {
            if (key.startsWith(dir + '/')) {
                return true;
            }
        }
        return false;
    }

    async childPaths(dir) {
        const result = [];
        for (const key of this.storage_.keys()) {
            if (key === dir) {
                continue;
            }
            if (!key.startsWith(dir)) {
                continue;
            }
            const filename = key.substring(dir.length+1);
            if (filename.indexOf('/') >= 0) {
                continue;
            }
            result.push(filename);
        }
        return result;
    }

    async emptyDir(dir) {
        const path = dir + '/';
        for (const key of this.storage_.keys()) {
            if (!key.startsWith(path)) {
                continue;
            }
            this.storage_.delete(key);
        }
    }

    async renameDir(from, to) {
        console.log('renaming', from, to);
        for (const key of this.storage_.keys()) {
            if (!key.startsWith(from)) {
                continue;
            }
            const newPath = to + key.substring(from.length);
            console.log(key, '->', newPath);
            this.storage_.set(newPath, this.storage_.get(key));
            this.storage_.delete(key);
        }
    }
}

class FD {
    static nextFD_ = 1000;

    static nextFD() {
        const fd = FD.nextFD_;
        FD.nextFD_++;
        return fd;
    }

    constructor(fd, path, offset) {
        this.fd_ = fd;
        this.path_ = path;
        this.offset_ = offset; // TODO: Rename to position?
    }

    get path() { return this.path_; }
    get offset() { return this.offset_; }
    set offset(offset) { this.offset_ = offset; }

    isCharacterDevice() {
        if (this.fd_ === 0 || this.fd_ === 1 || this.fd_ === 2) {
            return true;
        }
        if (this.path_ === '/dev/null') {
            return true;
        }
        return false;
    }
}

class FS {
    static get statModes() {
        return {
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
    }

    static tools() {
        return ['asm', 'buildid', 'compile', 'link', 'pack'];
    }

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
        this.files_ = new Storage();
        this.fds_ = new Map();
        this.ps_ = ps;
        this.writeSyncBuf_ = '';
        this.decoder_ = new TextDecoder('utf-8');
    }
    
    async initializeFiles() {
        await this.files_.set('/', {
            directory: true,
        });
        await this.files_.set('/tmp', {
            directory: true,
        });
        await this.files_.set('/dev', {
            directory: true,
        });
        await this.files_.set('/dev/null', {
        });
        await this.files_.set('/root', {
            directory: true,
        });
        // GOPATH
        await this.files_.set('/root/go', {
            directory: true,
        });

        const goroot = '/go'
        await this.files_.set(goroot, {
            directory: true,
        });

        // stdlib files
        // TODO: Load them lazily
        let stdfiles = await (await fetch('./stdfiles.json')).json();
        for (const filename of Object.keys(stdfiles)) {
            const fullfn = goroot + '/' + filename;
            const dir = fullfn.substring(0, fullfn.lastIndexOf('/'));
            await this.mkdirp_(dir);
            await this.files_.set(fullfn, {
                content: Uint8Array.from(atob(stdfiles[filename]), c => c.charCodeAt(0)),
            });
        }

        // Dummy files for tools
        await this.files_.set(goroot + '/pkg', {
            directory: true,
        });
        await this.files_.set(goroot + '/pkg/tool', {
            directory: true,
        });
        await this.files_.set(goroot + '/pkg/tool/js_wasm', {
            directory: true,
        });
        for (const tool of FS.tools()) {
            await this.files_.set(goroot + `/pkg/tool/js_wasm/${tool}`, {
                content: new Uint8Array(0),
            });
        }
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

    // writeSync is called only from runtime.wasmSync. Use the default implementation.
    writeSync(fd, buf) {
        this.writeSyncBuf_ += this.decoder_.decode(buf);
        const nl = this.writeSyncBuf_.lastIndexOf("\n");
        if (nl != -1) {
            console.log(this.writeSyncBuf_.substr(0, nl));
            this.writeSyncBuf_ = this.writeSyncBuf_.substr(nl + 1);
        }
        return buf.length;
    }

    async pwrite_(fd, buf, position) {
        if (fd === 1) {
            globalThis.goInternal_.writeToStdout(buf);
            return buf.byteLength;
        }
        if (fd === 2) {
            globalThis.goInternal_.writeToStderr(buf);
            return buf.byteLength;
        }

        const handle = this.fds_.get(fd);
        if (handle.path === '/dev/null') {
            return buf.byteLength;
        }

        const file = await this.files_.get(handle.path);
        let content = file.content;
        let finalLength = content.byteLength;
        if (finalLength < position) {
            // TODO: Error?
        }
        if (finalLength < position + buf.byteLength) {
            finalLength = position + buf.byteLength;
        }

        // Extend the size if necessary
        let n = content.buffer.byteLength;
        if (n === 0) {
            n = 1024;
        }
        while (n < finalLength) {
            n *= 2;
        }

        if (content.buffer.byteLength < n) {
            const old = content;
            content = new Uint8Array(new ArrayBuffer(n), 0, finalLength);
            content.set(old);
        } else {
            content = new Uint8Array(content.buffer, 0, finalLength);
        }

        content.set(buf, position)

        file.content = content;
        await this.files_.set(handle.path, file);

        return buf.byteLength;
    }

    write(fd, buf, offset, length, position, callback) {
        (async() => {
            if (offset !== 0 || length !== buf.byteLength) {
                // TOOD: Implement this.
                callback(enosys('write'));
                return;
            }
            let n = 0;
            if (position !== null) {
                n = await this.pwrite_(fd, buf, position);
            } else {
                const handle = this.fds_.get(fd);
                let position = 0;
                // handle can be null when fd is 1 or 2.
                if (handle) {
                    position = handle.offset;
                }
                n = await this.pwrite_(fd, buf, position);
                if (handle && !handle.isCharacterDevice()) {
                    handle.offset += n;
                }
            }
            callback(null, n);
        })();
    }

    chmod(path, mode, callback) {
        callback(null);
    }

    chown(path, uid, gid, callback) {
        callback(null);
    }

    close(fd, callback) {
        (async() => {
            this.fds_.delete(fd);
            callback(null);
        })();
    }

    fchmod(fd, mode, callback) {
        callback(null);
    }

    fchown(fd, uid, gid, callback) {
        callback(null);
    }

    fstat(fd, callback) {
        (async() => {
            await this.stat_(this.fds_.get(fd).path, callback);
        })();
    }

    fsync(fd, callback) {
        callback(null);
    }

    ftruncate(fd, length, callback) {
        (async() => {
            const handle = this.fds_.get(fd);
            const file = await this.files_.get(handle.path);
            file.content = new Uint8Array(file.content.buffer, 0, length);
            await this.files_.set(this.fds_.get(fd).path, file);
            callback(null);
        })();
    }

    lchown(path, uid, gid, callback) {
        callback(enosys('lchown'));
    }

    link(path, link, callback) {
        callback(enosys('link'));
    }

    lstat(path, callback) {
        (async() => {
            await this.stat_(path, callback);
        })();
    }

    mkdir(path, perm, callback) {
        (async() => {
            path = FS.absPath(this.ps_.cwd(), path);
            const ds = FS.dirs(path);
            for (let i = 0; i < ds.length; i++) {
                const file = await this.files_.get(ds[i]);
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
            await this.files_.set(path, {
                directory: true,
            });
            callback(null);
        })();
    }

    open(path, flags, mode, callback) {
        (async() => {
            path = FS.absPath(this.ps_.cwd(), path);
            if (!await this.files_.has(path)) {
                if (!(flags & this.constants.O_CREAT)) {
                    const err = new Error('no such file or directory');
                    err.code = 'ENOENT';
                    callback(err);
                    return;
                }
                await this.files_.set(path, {
                    content:   new Uint8Array(0),
                    directory: false,
                });
            }

            if (flags & this.constants.O_TRUNC) {
                await this.files_.set(path, {
                    content:   new Uint8Array(0),
                    directory: false,
                });
            }

            let offset = 0;
            if (flags & this.constants.O_APPEND) {
                offset = (await this.files_.get(path)).content.byteLength;
            }
            const fd = FD.nextFD();
            this.fds_.set(fd, new FD(fd, path, offset));
            callback(null, fd);
        })();
    }

    async pread_(fd, buffer, offset, length, position) {
        const handle = this.fds_.get(fd);
        const file = await this.files_.get(handle.path);
        const content = file.content;
        let n = length;
        if (n > content.byteLength - position) {
            n = content.byteLength - position;
        }
        if (n > buffer.byteLength - offset) {
            n = buffer.byteLength - offset;
        }
        for (let i = 0; i < n; i++) {
            buffer[offset+i] = content[position+i];
        }
        return n;
    }

    read(fd, buffer, offset, length, position, callback) {
        (async() => {
            if (fd === 0) {
                const result = this.stdin_(buf);
                if (typeof result === 'number') {
                    const n = result;
                    if (n === 0) {
                        // 0 indicates EOF.
                        callback(null, 0);
                        return;
                    }
                    const buf = new Uint8Array(length);
                    for (let i = 0; i < n; i++) {
                        buffer[offset+i] = buf[i];
                    }
                    callback(null, buf.byteLength);
                } else {
                    callback(new Error(result));
                }
                return;
            }

            let n = 0;
            if (position !== null) {
                n = await this.pread_(fd, buffer, offset, length, position);
            } else {
                const handle = this.fds_.get(fd);
                // handle can be null when fd is 0.
                let position = 0;
                if (handle) {
                    position = handle.offset;
                }
                n = await this.pread_(fd, buffer, offset, length, position);
                if (handle && !handle.isCharacterDevice()) {
                    handle.offset += n;
                }
            }
            callback(null, n);
        })();
    }

    readdir(path, callback) {
        (async() => {
            path = FS.absPath(this.ps_.cwd(), path);
            const filenames = await this.filenamesAt_(path);
            callback(null, filenames);
        })();
    }

    readlink(path, callback) {
        callback(enosys('readlink'));
    }

    rename(from, to, callback) {
        (async() => {
            from = FS.absPath(this.ps_.cwd(), from);
            to = FS.absPath(this.ps_.cwd(), to);
            const fromFile = await this.files_.get(from)
            const toFile = await this.files_.get(from)
            if (!fromFile) {
                const err = new Error('no such file or directory');
                err.code = 'ENOENT';
                callback(err);
                return;
            }
            // TODO: What about file handlers when deleting the original files?
            if (fromFile.directory) {
                if (!toFile) {
                    await this.files._renameDir(from, to);
                    return;
                }
                if (!toFile.directory) {
                    const err = new Error('not a directory');
                    err.code = 'ENOTDIR';
                    callback(err);
                    return;
                }
                if (await this.files_.hasChildren(to)) {
                    const err = new Error('directory not empty');
                    err.code = 'ENOTEMPTY';
                    callback(err);
                    return;
                }
                await this.files_.delete(to);
                await this.files_.renameDir(from, to);
                return;
            }
            if (toFile.directory) {
                callback(enosys('rename'));
                return;
            }
            await this.files_.set(to, fromFile)
            await this.files_.delete(from)
            callback(null);
        })();
    }

    rmdir(path, callback) {
        (async() => {
            // TODO: What if there exists a file handler to the directory?
            path = FS.absPath(this.ps_.cwd(), path);
            const file = await this.files_.get(path);
            if (!file) {
                const err = new Error('no such file or directory');
                err.code = 'ENOENT';
                callback(err);
                return;
            }
            if (!file.directory) {
                const err = new Error('not a directory');
                err.code = 'ENOTDIR';
                callback(err);
                return;
            }
            if (await this.files_.hasChildren(path)) {
                const err = new Error('directory not empty');
                err.code = 'ENOTEMPTY';
                callback(err);
                return;
            }
            await this.files_.delete(path);
            callback(null);
        })();
    }

    stat(path, callback) {
        (async() => {
            await this.stat_(path, callback);
        })();
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
        (async() => {
            // TODO: What if there exists a file handler to the file?
            path = FS.absPath(this.ps_.cwd(), path);
            const file = await this.files_.get(path);
            if (!file) {
                const err = new Error('no such file or directory');
                err.code = 'ENOENT';
                callback(err);
                return;
            }
            if (file.directory) {
                const err = new Error('is a directory');
                err.code = 'EISDIR';
                callback(err);
                return;
            }
            await this.files_.delete(path);
            callback(null);
        })();
    }

    utimes(path, atime, mtime, callback) {
        (async() => {
            path = FS.absPath(this.ps_.cwd(), path);
            const file = await this.files_.get(path);
            file.atime = atime;
            file.mtime = mtime;
            await this.files_.set(path, file);
            callback(null);
        })();
    }

    async stat_(path, callback) {
        path = FS.absPath(this.ps_.cwd(), path);
        if (!await this.files_.has(path)) {
            const err = new Error('no such file or directory');
            err.code = 'ENOENT';
            callback(err);
            return;
        }
        let mode = 0;
        const file = await this.files_.get(path);
        if (file.directory) {
            mode |= FS.statModes.S_IFDIR;
        } else {
            mode |= FS.statModes.S_IFREG;
        }
        let atime = 0;
        let mtime = 0;
        if (file.atime) {
            atime = file.atime * 1000;
        }
        if (file.mtime) {
            mtime = file.mtime * 1000;
        }
        let size = 0;
        if (!file.directory && file.content) {
            size = file.content.byteLength;
        }
        callback(null, {
            mode:    mode,
            dev:     0,
            ino:     0,
            nlink:   0,
            uid:     0,
            gid:     0,
            rdev:    0,
            size:    size,
            blksize: 0,
            blocks:  0,
            atimeMs: atime,
            mtimeMs: mtime,
            ctimeMs: 0,
            isDirectory: () => !!(mode & FS.statModes.S_IFDIR),
        });
    }

    async mkdirp_(dir) {
        for (const path of FS.dirs(dir)) {
            const file = await this.files_.get(path);
            if (file) {
                if (file.directory) {
                    continue;
                }
                const err = new Error('file exists');
                err.code = 'EEXIST';
                throw err;
            }
            await this.files_.set(path, {
                directory: true,
            });
        }
    }

    async filenamesAt_(dir) {
        return await this.files_.childPaths(dir);
    }

    async emptyDir_(dir) {
        await this.files_.emptyDir(dir);
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

class GoInternal {
    constructor() {
        this.initialized_ = false;
        this.stdin_ = null;
        this.stdout_ = null;
        this.stderr_ = null;
        this.stdoutBuf_ = '';
        this.stdoutDecoder_ = new TextDecoder('utf-8');
        this.stderrBuf_ = '';
        this.stderrDecoder_ = new TextDecoder('utf-8');
        this.wasmModules_ = new Map();
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
        const err = this.stdout_(buf);
        if (err) {
            throw err;
        }
    }

    writeToStderr(buf) {
        const err = this.stderr_(buf);
        if (err) {
            throw err;
        }
    }

    async wasmModule_(command) {
        let wasmModule = this.wasmModules_.get(command);
        if (wasmModule) {
            return wasmModule;
        }

        // Polyfill
        let compileStreaming = WebAssembly.compileStreaming;
        if (!compileStreaming) {
            compileStreaming = async (resp) => {
                const source = await (await resp).arrayBuffer();
                return await WebAssembly.compile(source);
            };
        }

        const goversion = '1.14beta1';
        const commandName = command.split('/').pop();
        let wasmPath = null;
        let wasmContent = null;
        if (command === 'go') {
            wasmPath = `./bin/go${goversion}.wasm`;
        } else if (command === `/go/pkg/tool/js_wasm/${commandName}` && FS.tools().includes(commandName)) {
            wasmPath = `./bin/${commandName}${goversion}.wasm`;
        } else if (await globalThis.fs.files_.has(command)) {
            wasmContent = (await globalThis.fs.files_.get(command)).content;
        } else {
            reject(new Error('command not found: ' + command));
            return;
        }

        if (wasmPath) {
            wasmModule = await compileStreaming(fetch(wasmPath));
        } else {
            wasmModule = await WebAssembly.compile(wasmContent);
        }
        this.wasmModules_.set(command, wasmModule);
        return wasmModule;
    }

    async execCommand(command, argv, env, dir, files, stdin, stdout, stderr) {
        await this.initializeGlobalVariablesIfNeeded();

        if (files) {
            for (const filename of Object.keys(files)) {
                const path = dir + '/' + filename;
                await globalThis.fs.files_.set(path, {
                    content: files[filename],
                });
            }
        }

        const wasmModule = await this.wasmModule_(command);
        const go = new Go();
        const wasmInstance = await WebAssembly.instantiate(wasmModule, go.importObject)
        const defaultEnv = {
            TMPDIR:      '/tmp',
            HOME:        '/root',
            GOROOT:      '/go',
            GO111MODULE: 'on',
            GOPROXY:     'cache.greedo.xeserv.us', // The default GOPROXY doesn't work due to CORS.
            GOSUMDB:     'off',                    // Ditto.
        };

        const origStdin = this.stdin_;
        const origStdout = this.stdout_;
        const origStderr = this.stderr_;
        this.stdin_ = stdin;
        this.stdout_ = stdout;
        this.stderr_ = stderr;
        const origCwd = globalThis.process.cwd();
        if (dir) {
            globalThis.process.chdir(dir);
        }
        const defer = () => {
            globalThis.process.chdir(origCwd);
            this.stdin_ = origStdin;
            this.stdout_ = origStdout;
            this.stderr_ = origStderr;
        };

        const commandName = command.split('/').pop();
        go.argv = [commandName].concat(argv || []);
        go.env = {...go.env, ...defaultEnv, ...env};
        try {
            await go.run(wasmInstance);
        } finally {
            defer();
        }
    }

    async execGo(argv, files) {
        const stdout = (buf) => {
            postMessage({
                type: 'stdout',
                body: buf,
            });
            return null;
        };
        const stderr = (buf) => {
            postMessage({
                type: 'stderr',
                body: buf,
            });
            return null;
        };

        try {
            await this.execCommand('go', argv, {}, '/root', files, null, stdout, stderr);
            await globalThis.fs.emptyDir_('/tmp');
        } finally {
            postMessage({
                type: 'exit',
                // TODO: Add code
            });
        }
    }
}

addEventListener('message', async (e) => {
    if (globalThis.started_) {
        throw new Error('go.js can be called only once');
    }
    globalThis.started_ = true;

    // JavaScript module in a dedicated worker is not supported in Chrome 79.
    // Fetch and eval the script instead.

    // geval is eval with the global scope.
    const geval = eval;
    geval(await (await fetch('./wasm_exec.js')).text());
    globalThis.goInternal_ = new GoInternal();

    const cmd = e.data.command[0];
    switch (cmd) {
    case 'go':
        await globalThis.goInternal_.execGo(e.data.command.slice(1), e.data.files);
        break;
    default:
        throw new Error(`command ${cmd} not supported`);
    }
});
