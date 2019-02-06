/**
 * Copyright (C) 2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2019-02-05 - AR.
 */

'use strict'

var sysStdout = process.stdout;
var sysWrite = process.stdout.write;

var qlogger = require('qlogger');
//var qlogger = require('../qlogger');    // FIXME: 'qlogger'
var kubelogger = require('./');

module.exports = {
    'should export a builder': function(t) {
        t.equal(typeof kubelogger, 'function');
        t.done();
    },

    'should build a qlogger': function(t) {
        t.ok(kubelogger() instanceof kubelogger);
        t.ok(kubelogger() instanceof qlogger);
        t.done();
    },

    'should default the loglevel': function(t) {
        t.equal(kubelogger().loglevel(), qlogger.LOGLEVELS['info']);
        t.done();
    },

    'should log a message': function(t) {
        var spy = t.stubOnce(kubelogger, 'write');
        kubelogger('info', 'stdout').info('Hello, test.');
        t.done();
    },

    'shold add a timestamp': function(t) {
        var spy = t.stubOnce(kubelogger, 'write');
        kubelogger('info', 'stdout').info('Hello, test.');
        t.ok(spy.called);
        t.contains(spy.args[0][0], '"time":');
        t.done();
    },

    'should use the provided type': function(t) {
        var spy = t.stubOnce(kubelogger, 'write');
        kubelogger('info', 'customType').info('Hello, test.');
        t.ok(spy.called);
        t.contains(spy.args[0][0], '"type":"customType"');
        t.done();
    },

    'should serialize objects': function(t) {
        var spy = t.stubOnce(kubelogger, 'write');
        kubelogger().info({ a: 1, b: 2 });
        t.ok(spy.called);
        t.contains(spy.args[0][0], '{"a":1,"b":2}');
        t.done();
    },

    'should tolerate unserializable objects': function(t) {
        var spy = t.stubOnce(kubelogger, 'write');
        var obj = { a: 1, b: 2 };
        obj.r = obj;
        kubelogger().info(obj);
        t.ok(spy.called);
        t.contains(spy.args[0][0], 'unserializable object');
        t.done();
    },

    'Kubelogger.write should write to stdout': function(t) {
        // TODO: run a child process, check its output
        kubelogger.write('testing 1 2 3\n');
        t.done();
    },

    'captureWrites': {
        'should capture and restore writes': function(t) {
            var logger = kubelogger('info', 'STDOUT').captureWrites(process.stdout);
            t.equal(logger.capturedWrites.length, 1);
            var spy = t.stub(kubelogger, 'write', function(str, cb) { cb() });
            console.log('Hello, world.');
            process.stdout.write('Hello again');
            logger.restoreWrites(process.stdout);
            spy.restore();
            t.equal(logger.capturedWrites.length, 0);
            t.ok(spy.called);
            t.contains(spy.args[0][0], '"type":"STDOUT"');
            t.contains(spy.args[0][0], '"message":"Hello, world.\\n"');
            t.contains(spy.args[1][0], '"type":"STDOUT"');
            t.contains(spy.args[1][0], '"message":"Hello again"');
            t.done();
        },

        'should restore writes on close': function(t) {
            var logger = kubelogger('info', 'console');
            var spy = t.spy(logger, 'restoreWrites');
            logger.captureWrites(process.stdout);
            logger.captureWrites(process.stderr);
            logger.captureWrites({ write: 1 });
            t.equal(logger.capturedWrites.length, 3);
            logger.close(function() {
                spy.restore();
                t.equal(logger.capturedWrites.length, 0);
                t.equal(spy.callCount, 3);
                t.done();
            })
        },

        'should not restore write if is not own capture function': function(t) {
            var logger = kubelogger();
            var obj = { write: 1 };
            logger.captureWrites(obj);
            t.equal(typeof obj.write, 'function');
            var newWrite = function(){};
            obj.write = newWrite;
            logger.restoreWrites(obj);
            t.equal(obj.write, newWrite);
            t.done();
        },

        'captureWrites should accept buffers': function(t) {
            var logger = kubelogger().captureWrites(process.stdout);
            var spy = t.stub(kubelogger, 'write', function(str, cb) { cb() });
            process.stdout.write(new Buffer("Buffer test"));
            logger.close(function() {
                spy.restore();
                t.contains(spy.args[0][0], '"message":"Buffer test"');
                t.done();
            })
        },

        'captureWrites should reject objects and numbers': function(t) {
            var logger = kubelogger().captureWrites(process.stdout);
            t.throws(function() { process.stdout.write({}) }, /invalid data/i);
            t.throws(function() { process.stdout.write(1) }, /invalid data/i);
            logger.close(t.done.bind(t));
        },

        'last': function(t) {
            console.log("Last");
            t.done();
        },
    },
}
