'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The two waits every e2e runner needs, shared by the Cordova and the Capacitor runners:
 * for the app to say it is done, and for the collector sink to stop receiving. Both take the
 * sleep through `deps`, so the runners' unit tests run them without real time.
 */

const commands = require('./commands.js');

const POLL_SEC = 5;

// Polls the app log until it says it is done, or the time is up. Where the log cannot be
// read (an iOS WKWebView console usually is not in the system log) the whole time is
// simply waited, which is the fixed wait the scenario needs anyway.
async function waitForDone(readLogs, totalSec, deps) {
    let elapsed = 0;
    for (;;) {
        const logs = await readLogs();
        const done = commands.parseDoneLine(logs);
        if (done || elapsed >= totalSec) return { done: done, logs: logs };
        await deps.sleep(POLL_SEC * 1000);
        elapsed += POLL_SEC;
    }
}

// The SDK posts in batches, so one read can miss late ones: wait until the count has not
// changed for two reads in a row (two flush cycles), or give up and say so.
async function waitForSink(sink, maxSec, deps) {
    let last = -1;
    let stable = 0;
    let elapsed = 0;
    for (;;) {
        const messages = await sink.messages();
        if (messages.length === last) stable += 1; else { stable = 0; last = messages.length; }
        if (stable >= 2) return { messages: messages, settled: true };
        if (elapsed >= maxSec) return { messages: messages, settled: false };
        await deps.sleep(POLL_SEC * 1000);
        elapsed += POLL_SEC;
    }
}

module.exports = { POLL_SEC, waitForDone, waitForSink };
