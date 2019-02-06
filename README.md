kubelogger
==========
[![Build Status](https://travis-ci.org/andrasq/node-kubelogger.svg?branch=master)](https://travis-ci.org/andrasq/node-kubelogger)
[![Coverage Status](https://coveralls.io/repos/github/andrasq/node-kubelogger/badge.svg?branch=master)](https://coveralls.io/github/andrasq/node-kubelogger?branch=master)

Quick logger for apps running inside Kubernetes containers.

A Kubelogger is a `qlogger` that is wired to convert all output to K8s compatible json
bundles and write them to the process stdout.  Different log streams can be distinguished by
their `type`.  All kubelogger output is written to stdout as newline terminated json bundles.
Each bundle has fields `time` and `type`, plus the `message`.


Quick Start
-----------

        const kubelogger = require('kubelogger');

        const appLogger = kubelogger('debug', 'MyApp');
        appLogger.info('app running');
        // => {"time":"2019-02-05T20:15:45.830Z","type":"MyApp","message":"app running"}

        const consoleLogger = kubelogger('info', 'console')
            .captureWrites(process.stdout)
            .captureWrites(process.stderr);
        console.log('Hello, world.');
        process.stderr.write('Oops!');
        // => {"time":"2019-02-05T20:13:13.240Z","type":"console","message":"Hello, world.\n"}
        // => {"time":"2019-02-05T20:13:13.241Z","type":"console","message":"Oops!\n"}


API
---

### logger = kubelogger( loglevel, type )

Create a new logger.  The default loglevel is 'info', the default type 'undefined'.  The
logger is `instanceof qlogger` with a predefined filter to convert all log messages into
json bundles, and a predefined writer to write the bundle to the process stdout.

The json bundles have properties `time`, `type` and `message`.  Time is formatted like
`Date.toISOString()`, but much faster (faster than `String(Date.now())`; faster even than
`String(count++)`).  Type is as received by the constructor.  The message is the JSON
stringified string or object being logged.

        const logger = kubelogger('info', 'example');
        logger.info('test');
        // => {"time":"2019-02-05T20:13:14.481Z","type":"example","message":"test\n"}
        logger.warn({ code: 'green', ok: 1 });
        // => {"time":"2019-02-05T20:13:14.482Z","type":"example","message":{"code":"green","ok":1}}

### logger.captureWrites( stream )

Convert all writes to the given stream into log messages sent to this logger.  Log message
formatting and output is handled as described above.  Unlike `Stream.write`, the written
arguments are not checked to be 'string' or 'Buffer'.

        const logger = kubelogger('info', 'stdout').captureWrites(process.stdout);
        console.log('gotcha!');
        // => {"time":"2019-02-05T20:13:14.483Z","type":"stdout","message":"gotcha!\n"}

### logger.restoreWrites( stream )

Undo a `captureWrites`, restore normal write behavior on the stream.  Not normally needed
inside a container, but is useful for testing, and just in case.

### logger.close( callback )

Flush pending output, restore the captured writes, and invoke `callback` with any deferred
logging error(s).  Call when exiting the app to not leave unwritten messages in the buffers.


Change Log
----------

- 1.0.0 - first version


Related Work
------------

[qlogger](https://github.com/andrasq/qlogger)
