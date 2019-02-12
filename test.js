/**
 * Copyright (C) 2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2019-02-05 - AR.
 */

'use strict'

var child_process = require('child_process');
var sysStdout = process.stdout;
var sysWrite = process.stdout.write;

var qlogger = require('qlogger');
var kubelogger = require('./');

module.exports = {
    'should export a builder': function(t) {
        t.equal(typeof kubelogger, 'function');
        t.done();
    },

    'should export qlogger and its filters': function(t) {
        t.equal(typeof kubelogger.QLogger, 'function');
        t.equal(typeof kubelogger.filters, 'object');
        t.equal(typeof kubelogger.filters.BasicFilter, 'function');
        t.equal(typeof kubelogger.filters.JsonFilter, 'function');
        t.equal(typeof kubelogger.filters.formatJsDateIsoString, 'function');
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
        var cmdline = 'echo \'require("./").write("testing 1 2 3\\\\n")\' | node';
        child_process.exec(cmdline, function(err, stdout, stderr) {
            t.ifError(err);
            t.contains(stdout, /^testing 1 2 3\n/);
            t.done();
        })
    },

    'addFilter should leave built-in json serialization step at end': function(t) {
        var logger = kubelogger('info', 'filtered');
        t.expect(6);
        logger.addFilter(function(obj) { obj.filtered = true; return obj });
        t.equal(logger.getFilters().length, 2);

        var spy = t.stubOnce(kubelogger, 'write', function(str, cb) { cb() });
        logger.info({ test: 12345 });
        logger.fflush(function() {
            t.equal(spy.callCount, 1);
            var json = JSON.parse(spy.args[0][0]);
            t.ok(/^\d{4}-\d{2}-\d{2}/.test(json.time));
            t.strictEqual(json.type, 'filtered');
            t.strictEqual(json.message.test, 12345);
            t.strictEqual(json.message.filtered, true);
            t.done();
        })
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

        'should displace an existing capture': function(t) {
            var logger1 = kubelogger('info', 'cap1').captureWrites(process.stdout);
            var logger2 = kubelogger('info', 'cap2').captureWrites(process.stdout);
            var spy = t.stub(kubelogger, 'write', function(str, cb) { cb() });
            console.log("captured text");
            t.ok(spy.called);
            t.equal(spy.callCount, 1);
            t.contains(spy.args[0][0], '"type":"cap2"');
            process.stdout.write.restore();
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
