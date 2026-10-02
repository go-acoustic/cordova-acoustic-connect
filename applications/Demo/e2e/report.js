'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The verdict of an e2e run and the results-<platform>.md that explains it. Follows the
 * reporting rules of the release-verification skill: every verdict cites evidence, the
 * environment is recorded, what was reverted is listed, and an inconclusive run says why
 * instead of showing an empty table.
 */

function overallVerdict(args) {
    const evaluation = args.evaluation;
    const done = args.done;
    if (!evaluation || args.messageCount === 0) return 'INCONCLUSIVE';
    // the app could not even start the scenario: nothing was exercised
    if (done && (done.status === 'sdk-timeout' || done.status === 'no-plugin')) return 'INCONCLUSIVE';
    if (!evaluation.pass) return 'FAIL';
    if (done && done.status !== 'pass') return 'FAIL';
    return 'PASS';
}

function exitCodeFor(verdict) {
    return verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2;
}

function cell(text) {
    return String(text === undefined ? '' : text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function buildReport(r) {
    const env = r.env || {};
    const lines = [];
    lines.push('# E2E verification - ' + r.platform + (r.phase === 'default' ? '' : ' (' + r.phase + ')'));
    lines.push('');
    lines.push('Verdict: ' + r.verdict);
    lines.push('');
    lines.push('Started: ' + r.startedAt);
    lines.push('');
    lines.push('## Environment');
    lines.push('');
    lines.push('- Repo commit: ' + env.repoCommit);
    lines.push('- Plugin under test: ' + env.pluginMode + ', version ' + env.pluginVersion);
    lines.push('- Native Connect SDK: ' + env.nativeSdk);
    lines.push('- Device: ' + env.device);
    lines.push('- Collector sink: ' + env.sinkUrl);
    lines.push('- ConnectConfig.json keys that differ from the example (names only): ' +
        ((env.configKeysDiffering || []).join(', ') || 'none'));
    if (env.extraConnectConfig && Object.keys(env.extraConnectConfig).length > 0) {
        lines.push('- Extra Connect settings (--connect-config): ' + cell(JSON.stringify(env.extraConnectConfig)));
    }
    lines.push('- App-side scenario: ' + (r.done
        ? 'E2E_DONE status=' + r.done.status + ' steps=' + r.done.steps + ' failed=' + r.done.failed + ' unavailable=' + r.done.unavailable
        : 'E2E_DONE line not observed (the app log could not be read, or the app did not finish in time)'));
    lines.push('- Messages captured: ' + r.messageCount);
    lines.push('');

    if (r.notes && r.notes.length) {
        lines.push('## Notes');
        lines.push('');
        r.notes.forEach(function (n) { lines.push('- ' + n); });
        lines.push('');
    }

    lines.push('## Verdict table');
    lines.push('');
    if (!r.evaluation) {
        lines.push('No checks ran: ' + ((r.notes && r.notes[0]) || 'the run did not produce a capture') + '.');
    } else {
        lines.push('| Status | Check | Evidence |');
        lines.push('|---|---|---|');
        r.evaluation.entries.forEach(function (e) {
            lines.push('| ' + e.status + ' | ' + cell(e.name) + ' | ' + cell(e.status === 'N/A' ? e.reason : e.detail) + ' |');
        });
    }
    lines.push('');

    lines.push('## Not applicable');
    lines.push('');
    const na = r.evaluation ? r.evaluation.entries.filter(function (e) { return e.status === 'N/A'; }) : [];
    if (na.length === 0) {
        lines.push('None.');
    } else {
        na.forEach(function (e) { lines.push('- ' + e.name + ': ' + e.reason); });
    }
    lines.push('');

    lines.push('## What was reverted');
    lines.push('');
    (r.reverted && r.reverted.length ? r.reverted : ['nothing to revert']).forEach(function (x) { lines.push('- ' + x); });
    lines.push('');
    return lines.join('\n');
}

module.exports = { overallVerdict, exitCodeFor, buildReport };
