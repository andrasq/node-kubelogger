/**
 * logger for apps running inside Kubernetes containers
 * All messages are output to stdout as wrappered json with fields { time, type, message }.
 * Extends QLogger, so a kubelogger is fully qlogger compatible.
 *
 * Copyright (C) 2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2019-01-29 - AR.
 */

'use strict'

var fs = require('fs');
var util = require('util');
var QLogger = require('qlogger');
var filters = require('qlogger/filters');

var getFormattedTimestamp = filters.formatJsDateIsoString;
var sysStdout = process.stdout;
var sysStdoutWrite = process.stdout.write;
var sysFlushable = new QLogger().addWriter(process.stdout);

module.exports = Kubelogger;
module.exports.QLogger = QLogger;
module.exports.filters = filters;

/*
 * create a new logger for the specified type
 * Each stream message is encoded as a line of tagged JSON, and
 * is written to the system process.stdout.
 * Logs 340k lines/sec to stdout, 995k/sec to a file.
 */
function Kubelogger( level, type ) {
    // TODO: allow options to override some defaults: timestamp, template
    if (!(this instanceof Kubelogger)) return new Kubelogger(level, type);

    type = JSON.stringify(String(type));
    this.capturedWrites = [];

    // inherit from QLogger, and configure self
    QLogger.call(this, level);
    this.addWriter({
        // wrapper the actual functions to provide a seam for testability
        write: function write(str, cb) { Kubelogger._write(str, cb) },
        fflush: function fflush(cb) { Kubelogger._fflush(cb) },
    });

    // install our custom serializer, and use a custom addFilter to keep our builtin as the last filter
    this._filters.push(function filter(str, level) { return Kubelogger._formatMessage(getFormattedTimestamp(), type, str) });
    this.addFilter = function addKubeFilter(func, level) {
        this._filters.splice(this._filters.length - 1, 0, func);
        return this;
    }
}
util.inherits(Kubelogger, QLogger);

Kubelogger._write = function _write( message, callback ) {
    sysStdoutWrite.call(sysStdout, message, callback);
}
Kubelogger._fflush = function _fflush( callback ) {
    sysFlushable.fflush(callback);
}
Kubelogger._formatMessage = function _formatMessage( time, type, message) {
    // convert objects into newline terminated json bundles
    try { message = JSON.stringify(message) } catch (err) { message = '"[unserializable object]"' }
    return '{"time":"' + time + '","type":' + type + ',"message":' + message + '}\n';
};
Kubelogger._restoreWrites = function _restoreWrites( stream ) {
    if (typeof stream._kubeErrorListener === 'function') {
        process.removeListener('uncaughtException', stream._kubeErrorListener);
        delete stream._kubeErrorListener;
    }
    if (stream.write && typeof stream.write.restore === 'function' && stream.write.name === '_writeCatcher_') {
        stream.write.restore();
    }
}
Kubelogger._captureWrites = function _captureWrites( stream, logit ) {
    // a stream can be sending its writes to only one logger at a time
    Kubelogger._restoreWrites(stream);

    var streamWriter = stream.write;
    stream.write = function _writeCatcher_(chunk, encoding, cb) {
        if (!cb && typeof encoding === 'function') { cb = encoding; encoding = null }

        // TODO: optionally split multi-line strings into separate messages
        // Note: buffers are assumed to not split utf8 chars across chunk boundaries
        //   This is a safe assumption for line-at-a-time text streams like the console.

        if (chunk instanceof Buffer) chunk = String(chunk);
        else if (chunk.constructor !== String) throw new TypeError('Invalid data, chunk must be a string or Buffer');
        logit(chunk, cb);
    }
    stream.write.restore = function() { return (stream.write = streamWriter) };

    if (stream === process.stderr) {
        stream._kubeErrorListener = Kubelogger._captureUncaughtException(stream);
    }
}

// If we are the only exception listener then we need to rethrow to stop the program,
// otherwise we can let the other exception listeners deal with deciding whether to stop.
// If a listener rethrows the exception before us, the process exits before we get to run.
// Our rethrow logic is as follows:
//   - if a previous listener decided to not kill the system, we let it be
//   - if a previous listener rethrew the error, the program died and we dont run
//   - if a subsequent listener exists, it can decide what should happen, we let it be
//   - if a subsequent listener rethrows, it kills the program, we dont see the same error again
//   - else if there was no previous listener and there are no other listeners after us,
//     we emulate the default behavior and rethrow the error to stop the program
// Note that if a listener after us rethrows the error, our fflush will get killed.
// Note that the presence of a transient listen-once passive listener (like ourselves) can
// confuse a listener (us) into not rethrowing; hooking to 'uncaughtException' is tricky.
// Corner cases:
//   - a rethrow from an async callback outside the listener will not kill the program
//
Kubelogger._captureUncaughtException = function _captureUncaughtException( stream ) {
    var hadPreviousListener = (process.listeners('uncaughtException').length > 0);
    function _exceptionCatcher_(err) {
        stream.write('uncaughtException: ' + (err && err.stack || String(err)));
        var needToRethrow = (!hadPreviousListener && process.listeners('uncaughtException').length === 0);
        Kubelogger._fflush(function() {
            if (needToRethrow) Kubelogger._rethrow(err);
            else process.once('uncaughtException', _exceptionCatcher_);
        })
    }
    // auto-remove our listener to not influence any other error handlers
    process.once('uncaughtException', _exceptionCatcher_);
    return _exceptionCatcher_;
}
Kubelogger._rethrow = function _rethrow(err) {
    throw err;
};

// flush the writes still in progress and unhook the intercepts
Kubelogger.prototype.close = function close( cb ) {
    while (this.capturedWrites.length > 0) this.restoreWrites(this.capturedWrites.shift());
    this.fflush(cb);
}

// redirect writes on the stream (eg process.stdout) to our logger instead
Kubelogger.prototype.captureWrites = function captureWrites( stream ) {
    var logger = this;
    Kubelogger._captureWrites(stream, function(str, cb) {
        logger.log(str);
        // TODO: why call *this* callback on write?  Notification?
        // TODO: Note that the callback is undocumented.
        if (cb) Kubelogger._fflush(cb);
    })
    this.capturedWrites.push(stream);
    return this;
}

// restore direct writes to the given stream (eg process.stdout)
Kubelogger.prototype.restoreWrites = function restoreWrites( stream ) {
    Kubelogger._restoreWrites(stream);
    var ix = this.capturedWrites.indexOf(stream);
    if (ix >= 0) this.capturedWrites.splice(ix, 1);
    return this;
}

Kubelogger.prototype = toStruct(Kubelogger.prototype);
function toStruct(obj) { return toStruct.prototype = obj }


// nb: console.log is slow, about 150k 70-char lines / sec (both direct and with .call)
// nb: stdout.write is 3x faster, about 330k 70-char lines / sec (bypassing console.log)
// Stdout probably writes immediately, and buffering would have to be careful to flush in case of crash.
// Note: writes of Buffers with utf-8 chars split across write boundaries are not handled.
// Note: because of internal buffering, different loggers may write out of sequence (eg stdout and stderr loggers).
//   Logging to a single unified stream 'console' would fix it.
// nb: works with node-v0.8, node-v0.6, does not redirect stderr (but yes stdout) with nojde-v0.4
