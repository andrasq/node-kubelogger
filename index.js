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

var getFormattedTimestamp = filters.formatJsDateIsoString || function() { return new Date().toISOString() };
var sysStdout = process.stdout;
var sysStdoutWrite = process.stdout.write;
var sysFlushable = new QLogger().addWriter(process.stdout);

module.exports = Kubelogger;

/*
 * create a new logger for the specified type
 * Each stream message is encoded as a line of tagged JSON, and
 * is written to the system process.stdout.
 * Logs 340k lines/sec to stdout, 995k/sec to a file.
 */
function Kubelogger( level, type ) {
    // TODO: allow options to override some defaults: timestamp, template
    if (!(this instanceof Kubelogger)) return new Kubelogger(level, type);

    type = String(type);
    this.capturedWrites = [];

    // inherit from QLogger, and configure self
    QLogger.call(this, level);
    this.addWriter({
        // wrapper the actual functions to provide a seam for testability
        write: function(str, cb) { Kubelogger.write(str, cb) },
        fflush: function(cb) { Kubelogger.fflush(cb) },
    });
    this.addFilter(function(str, level) {
        return Kubelogger.formatMessage(getFormattedTimestamp(), type, str);
    });
}
util.inherits(Kubelogger, QLogger);

Kubelogger.write = function write( message, callback ) {
    sysStdoutWrite.call(sysStdout, message, callback);
}
Kubelogger.fflush = function fflush( callback ) {
    sysFlushable.fflush(callback);
}
Kubelogger.formatMessage = function( time, type, message) {
    // convert objects into newline terminated json bundles
    try { message = JSON.stringify(message) } catch (err) { message = '"[unserializable object]"' }
    return '{"time":"' + time + '","type":"' + type + '","message":' + message + '}\n';
};
Kubelogger.restoreWrites = function restoreWrites( stream ) {
    if (typeof stream.write.restore === 'function' && stream.write.name === '_writeCatcher_') {
        stream.write.restore();
    }
}
Kubelogger.captureWrites = function captureWrites( stream, logit ) {
    // a stream can be sending its writes to only one logger at a time
    if (stream.write.name === '_writeCatcher_') Kubelogger.restoreWrites(stream);

    var streamWriter = stream.write;
    stream.write = function _writeCatcher_(chunk, encoding, cb) {
        if (!cb && typeof encoding === 'function') { cb = encoding; encoding = null }

        // Note: buffers are assumed to not split utf8 chars across chunk boundaries
        //   This is a safe assumption for line-at-a-time text streams like the console.
        // TODO: optionally split multi-line strings into separate messages

        if (chunk instanceof Buffer) chunk = String(chunk);
        else if (chunk.constructor !== String) throw new TypeError('Invalid data, chunk must be a string or Buffer');
        logit(chunk, cb);
    }
    stream.write.restore = function() { return (stream.write = streamWriter) };
    //this.capturedWrites.push(stream);
}

// flush the writes still in progress and unhook the intercepts
Kubelogger.prototype.close = function close( cb ) {
    while (this.capturedWrites.length > 0) this.restoreWrites(this.capturedWrites.shift());
    this.fflush(cb);
}

// redirect writes on the stream (eg process.stdout) to our logger instead
Kubelogger.prototype.captureWrites = function captureWrites( stream ) {
    var logger = this;
    Kubelogger.captureWrites(stream, function(str, cb) {
        logger.log(str);
        if (cb) Kubelogger.fflush(cb);
    })
    this.capturedWrites.push(stream);
    return this;
}

// restore direct writes to the given stream (eg process.stdout)
Kubelogger.prototype.restoreWrites = function restoreWrites( stream ) {
    Kubelogger.restoreWrites(stream);
    var ix = this.capturedWrites.indexOf(stream);
    if (ix >= 0) this.capturedWrites.splice(ix, 1);
    return this;
}


// nb: console.log is slow, about 150k 70-char lines / sec (both direct and with .call)
// nb: stdout.write is 3x faster, about 330k 70-char lines / sec (bypassing console.log)
// Stdout probably writes immediately, and buffering would have to be careful to flush in case of crash.
// Note: writes of Buffers with utf-8 chars split across write boundaries are not handled.
// Note: because of internal buffering, different loggers may write out of sequence (eg stdout and stderr loggers).
//   Logging to a single unified stream 'console' would fix it.
// nb: works with node-v0.8, node-v0.6, does not redirect stderr (but yes stdout) with nojde-v0.4
