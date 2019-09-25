/**
 * Copyright (C) 2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2019-02-05 - AR.
 */

'use strict'

var child_process = require('child_process');
var qibl = require('qibl');
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
        var spy = t.stubOnce(kubelogger, '_write');
        kubelogger('info', 'stdout').info('Hello, test.');
        t.done();
    },

    'shold add a timestamp': function(t) {
        var spy = t.stubOnce(kubelogger, '_write');
        kubelogger('info', 'stdout').info('Hello, test.');
        t.ok(spy.called);
        t.contains(spy.args[0][0], '"time":');
        t.done();
    },

    'should use the provided type': function(t) {
        var spy = t.stubOnce(kubelogger, '_write');
        kubelogger('info', 'customType').info('Hello, test.');
        t.ok(spy.called);
        t.contains(spy.args[0][0], '"type":"customType"');
        t.done();
    },

    'should serialize objects': function(t) {
        var spy = t.stubOnce(kubelogger, '_write');
        kubelogger().info({ a: 1, b: 2 });
        t.ok(spy.called);
        t.contains(spy.args[0][0], '{"a":1,"b":2}');
        t.done();
    },

    'should tolerate unserializable objects': function(t) {
        var spy = t.stubOnce(kubelogger, '_write');
        var obj = { a: 1, b: 2 };
        obj.r = obj;
        kubelogger().info(obj);
        t.ok(spy.called);
        t.contains(spy.args[0][0], 'unserializable object');
        t.done();
    },

    'Kubelogger._write should write to stdout': function(t) {
        var cmdline = 'echo \'require("./")._write("testing 1 2 3\\\\n")\' | node';
        child_process.exec(cmdline, function(err, stdout, stderr) {
            t.ifError(err);
            t.contains(stdout, /^testing 1 2 3\n/m);
            t.done();
        })
    },

    'addFilter should leave built-in json serialization step at end': function(t) {
        var logger = kubelogger('info', 'filtered');
        t.expect(6);
        logger.addFilter(function(obj) { obj.filtered = true; return obj });
        t.equal(logger.getFilters().length, 2);

        var spy = t.stubOnce(kubelogger, '_write', function(str, cb) { cb() });
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
            var spy = t.stub(kubelogger, '_write', function(str, cb) { cb() });
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
            var spy = t.stub(kubelogger, '_write', function(str, cb) { cb() });
            console.log("captured text");
            spy.restore();
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
            var writer = { write: 1 };
            logger.captureWrites(writer);
            t.equal(typeof writer.write, 'function');
            var newWrite = function(){};
            writer.write = newWrite;
            logger.restoreWrites(writer);
            t.equal(writer.write, newWrite);
            t.done();
        },

        'captureWrites should accept buffers': function(t) {
            var logger = kubelogger().captureWrites(process.stdout);
            var spy = t.stub(kubelogger, '_write', function(str, cb) { cb() });
            process.stdout.write(qibl.newBuf("Buffer test"));
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

        // run this test last! it kills the process
        'should capture uncaughtException messages when capturing stderr ': function(t) {
            // remove the error global listener installed by the unit test runner to not die on our test error
            var listeners = removeAllListeners(process, 'uncaughtException');

            var logger = kubelogger().captureWrites(process.stderr);
            var spy = t.stub(kubelogger, '_write');
            setTimeout(function() {
                throw new Error('uncaught mock global exception');
            })
            setTimeout(function() {
                spy.restore();

                // restore the unit test error listeners for the other tests
                addListeners(process, 'uncaughtException', listeners);

                t.ok(spy.called);
                t.contains(JSON.parse(spy.args[0][0]).message, /uncaughtException:/);
                t.contains(JSON.parse(spy.args[0][0]).message, /uncaught mock global exception/m);

                t.done();
            }, 10);
            // prevent the catcher from rethrowing the error and killing the process
            process.once('uncaughtException', function(err) { });
        },

        'kubelogger._rethrow should throw the error': function(t) {
            var err = new Error('mock error');
            t.throws(function(){ kubelogger._rethrow(err) }, 'mock error');
            t.done();
        },

        'should use kubelogger._rethrow to rethrow error if no other uncaught exception listeners': function(t) {
            var listeners = removeAllListeners(process, 'uncaughtException');
            var stub = t.stubOnce(kubelogger, '_write', function(s, cb) { cb() });
            var spy = t.stub(kubelogger, '_rethrow');
            kubelogger().captureWrites(process.stderr);
            setTimeout(function() {
                throw new Error('mock global error');
            });
            setTimeout(function() {
                spy.restore();
                addListeners(process, 'uncaughtException', listeners);
                t.ok(spy.called);
                t.equal(String(spy.args[0][0]), 'Error: mock global error');
                t.done();
            }, 10);
        },

        'should run all exception listeners and not rethrow if have other uncaught exception listeners': function(t) {
            var listeners = removeAllListeners(process, 'uncaughtException');

            var errorList = [];
            process.once('uncaughtException', function before(err) { errorList.push(err) });
            kubelogger().captureWrites(process.stderr);
            process.once('uncaughtException', function after(err) { errorList.push(err) });
            var stub = t.stubOnce(kubelogger, '_write', function(str, cb) { cb() });
            var spy = t.spy(kubelogger, '_rethrow');

            setTimeout(function() {
                throw 'mock uncaught error';
            });
            setTimeout(function() {
                var listenerCount = process.listeners('uncaughtException').length;
                addListeners(process, 'uncaughtException', listeners);
                var restoredListenersCount = process.listeners('uncaughtException').length;
                
                t.ok(stub.called);
                t.ok(!spy.called);
                t.deepEqual(errorList, ['mock uncaught error', 'mock uncaught error']);
                // kubelogger was still listening, the other two were one-shot
                t.equal(listenerCount, 1);

                kubelogger._restoreWrites(process.stderr);
                // should have now removed the kubelogger listener too
                t.equal(process.listeners('uncaughtException').length, restoredListenersCount - 1);
                t.done();
            }, 10);
        },

        'should capture stderr many times without exceeding maxListeners': function(t) {
            for (var i=0; i<100; i++) kubelogger().captureWrites(process.stderr);
            process.stderr.write.restore();
            t.done();
        },

        'last': function(t) {
            // invoke kubelogger.write() directly too, test coverage does not traverse a fork()
            kubelogger._write('Last\n');
            t.done();
        },
    },
}

function removeAllListeners( emitter, event ) {
    var listeners = emitter.listeners(event);
    for (var i=0; i<listeners.length; i++) emitter.removeListener(event, listeners[i]);
    return listeners;
}

function addListeners( emitter, event, listeners ) {
    for (var i=0; i<listeners.length; i++) emitter.on(event, listeners[i]);
    return listeners;
}
