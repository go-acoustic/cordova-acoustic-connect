/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Internal demo for the Acoustic Connect Capacitor plugin, the same screens as the Cordova Demo app.
 * Three tabs — Notification, Identity, Behaviour. Behaviour has three sections:
 * Actions (quick calls), Showcase (one card per feature) and Verification
 * (scenarios with the expected result, see js/behaviour/).
 *
 * The SDK is started by the plugin block of capacitor.config.json when the app launches; this page only waits for it.
 */

import { Capacitor } from '@capacitor/core';
import { AcousticConnect } from 'capacitor-acoustic-connect';

import './behaviour/behaviour-core.js';
import './behaviour/behaviour.js';

// The Behaviour screens (behaviour.js) and the browser console reach the plugin through this, as the Cordova global.
window.AcousticConnect = AcousticConnect;

const MAX_HIST = 5;
const HIST_KEY = 'acoustic_identity_history';
const SDK_WAIT_TRIES = 30;
const SDK_WAIT_MS = 1000;

let identityHistory = [];

onReady();

// `VITE_E2E=1 vite build` runs the release-verification scenario once the SDK is up (see js/e2e.js).
if (import.meta.env.VITE_E2E) {
    import('./e2e.js');
}

function onReady() {
    const platform = Capacitor.getPlatform();
    const status = document.getElementById('deviceready');
    status.textContent = 'Capacitor ready · ' + platform;
    status.classList.add('ready');

    showVersionInfo(platform);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // ── Notification tab ────────────────────────────────────────────
    document.getElementById('btn_enable_push').addEventListener('click', () => {
        AcousticConnect.push
            .requestPermission()
            .then((result) => {
                const granted = Boolean(result && result.granted);
                updateAuthStatus(granted, granted ? 'Push notifications are enabled' : 'Push notifications permission denied');
            })
            .catch((error) => {
                log('✗ pushRequestPermission → ' + fmt(error));
                updateAuthStatus(false, 'Error: ' + fmt(error));
            });
    });

    // Re-check permission state every time the app comes back to the foreground so the badge stays accurate after the
    // system permission dialog.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshPermissionState();
    });

    // ── Identity tab ────────────────────────────────────────────────
    document.getElementById('btn_send_identity_signal').addEventListener('click', logUserLoggedIn);
    document.getElementById('btn_send_account_registered_signal').addEventListener('click', logUserRegistered);

    // ── Behaviour tab ───────────────────────────────────────────────
    initBehaviourTab(platform);
    if (window.BehaviourUi) window.BehaviourUi.init();

    loadHistory();
    waitForSdk();
}

// ── Version info ────────────────────────────────────────────────────────

// Shows the plugin and, under it, the native Connect SDK's own library version for the running platform
// (Android and iOS have independently versioned native SDKs).
function showVersionInfo(platform) {
    const el = document.getElementById('versionInfo');
    const platformLabel = platform === 'android' ? 'Android' : platform === 'ios' ? 'iOS' : 'web';

    el.textContent = 'capacitor-acoustic-connect';
    el.classList.remove('hidden');

    AcousticConnect.getSdkVersion()
        .then((sdkVersion) => {
            el.textContent = 'capacitor-acoustic-connect · ' + platformLabel + ' SDK v' + sdkVersion;
        })
        .catch(() => {
            // Leave the plugin-only line in place: the native SDK version is a bonus, not required to use the app
            // (and unavailable in a browser).
        });
}

// ── SDK start ───────────────────────────────────────────────────────────

// The plugin starts the SDK from capacitor.config.json when the app launches. Wait until it reports enabled before
// the buttons come alive; if it never does, say what is missing.
async function waitForSdk() {
    for (let i = 0; i < SDK_WAIT_TRIES; i += 1) {
        try {
            if (await AcousticConnect.isSdkEnabled()) {
                onSdkEnabled();
                return;
            }
        } catch (_) {
            // not up yet, or not available in a browser
        }
        await new Promise((resolve) => setTimeout(resolve, SDK_WAIT_MS));
    }
    log('SDK not started — check appKey and postMessageUrl in the plugin block of capacitor.config.json');
    updateAuthStatus(false, 'Error: SDK not started — set appKey and postMessageUrl in capacitor.config.json');
}

// Called once the SDK is up: enable all buttons and read the current permission state.
function onSdkEnabled() {
    document.getElementById('btn_send_identity_signal').disabled = false;
    document.getElementById('btn_send_account_registered_signal').disabled = false;
    document.getElementById('btn_enable_push').disabled = false;
    setBehaviourEnabled(true);
    if (window.BehaviourUi) window.BehaviourUi.setEnabled(true);
    refreshPermissionState();
}

// ── Push permission state ──────────────────────────────────────────────

// Reads the OS notification permission and updates the auth badge only. The Enable Push button state is controlled by
// onSdkEnabled(): it stays enabled so the user can always re-request.
function refreshPermissionState() {
    AcousticConnect.push
        .getPermissionState()
        .then((state) => {
            if (state === true) {
                updateAuthStatus(true, 'Push notifications are enabled');
            } else if (state === false) {
                updateAuthStatus(false, 'Push notifications permission denied');
            }
            // null = not determined: the badge stays at the default "Not Authorized".
        })
        .catch(() => {});
}

// ── Tab switching ──────────────────────────────────────────────────────

const TAB_TITLES = { notification: 'Push', identity: 'Identity', behaviour: 'Behaviour' };

function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach((el) => el.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = TAB_TITLES[tab] || tab;
    AcousticConnect.setCurrentScreenName(tab + '_screen').catch(() => {});
}

// ── Notification Authorization ─────────────────────────────────────────

// Updates the Notification Authorization card: green dot + "Status: Authorized" when granted.
function updateAuthStatus(authorized, message) {
    const dot = document.getElementById('authDot');
    const text = document.getElementById('authStatusText');
    const msg = document.getElementById('authMessage');

    if (authorized) {
        dot.classList.add('authorized');
        text.textContent = 'Status: Authorized';
    } else {
        dot.classList.remove('authorized');
        text.textContent = 'Status: Not Authorized';
    }

    if (message) {
        const isError = message.startsWith('Error') || message.includes('disabled') || message.includes('denied');
        msg.textContent = message;
        msg.className = 'auth-message ' + (isError ? 'error' : 'success');
    } else {
        msg.className = 'auth-message hidden';
        msg.textContent = '';
    }
}

// ── Identity tab actions ───────────────────────────────────────────────

function logUserLoggedIn() {
    sendIdentitySignal('loggedIn', { loginMethod: 'email' });
}

function logUserRegistered() {
    sendIdentitySignal('accountRegistered', { registrationMethod: 'email' });
}

function sendIdentitySignal(signalType, additionalParameters) {
    const name = document.getElementById('et_identifier_name').value.trim();
    const value = document.getElementById('et_identifier_value').value.trim();
    const statusEl = document.getElementById('identStatus');

    if (!name || !value) {
        statusEl.textContent = 'Identifier name and value cannot be empty';
        statusEl.className = 'ident-status error';
        return;
    }

    statusEl.className = 'ident-status hidden';

    AcousticConnect.logIdentity(name, value, signalType, additionalParameters)
        .then(() => {
            statusEl.textContent = 'Identity signal was sent';
            statusEl.className = 'ident-status success';
            addHistory(name, value, signalType);
        })
        .catch((error) => {
            log('✗ logIdentity → ' + fmt(error));
            statusEl.textContent = error && error.message ? error.message : 'Failed to send identity signal';
            statusEl.className = 'ident-status error';
        });
}

// ── Behaviour tab actions ──────────────────────────────────────────────

const BEHAVIOUR_BUTTONS = [
    'btn_log_custom_event', 'btn_log_signal', 'btn_log_click', 'btn_log_text_change',
    'btn_screen_load', 'btn_screen_unload', 'btn_screen_layout', 'btn_log_exception', 'btn_flush',
];

function setBehaviourEnabled(enabled) {
    BEHAVIOUR_BUTTONS.forEach((id) => { document.getElementById(id).disabled = !enabled; });
}

function showBehaviourStatus(ok, text) {
    const el = document.getElementById('behaviourStatus');
    el.textContent = text;
    el.className = 'ident-status ' + (ok ? 'success' : 'error');
}

// Runs one analytics call and reports the outcome in the shared status line. A resolved promise means the SDK queued
// the event, not that the collector has it.
function runBehaviour(label, call) {
    call()
        .then(() => showBehaviourStatus(true, label + ' queued'))
        .catch((error) => {
            log('✗ ' + label + ' → ' + fmt(error));
            showBehaviourStatus(false, error && error.message ? error.message : label + ' failed');
        });
}

function initBehaviourTab(platform) {
    const A = AcousticConnect;
    const on = (id, handler) => document.getElementById(id).addEventListener('click', handler);

    on('btn_log_custom_event', () => {
        const name = document.getElementById('et_event_name').value.trim();
        runBehaviour('Custom event', () => A.logCustomEvent(name, { source: 'demo', platform }));
    });
    on('btn_log_signal', () => runBehaviour('Signal', () => A.logSignal({
        signalContent: { signalType: 'pageview', url: 'https://app.example.com/demo' },
        audience: [{ name: 'Account ID', value: '42' }],
    })));
    on('btn_log_click', () => runBehaviour('Click', () => A.logClickEvent('btn_demo', { screen: 'behaviour' })));
    on('btn_log_text_change', () => {
        const text = document.getElementById('et_text_value').value;
        runBehaviour('Text change', () => A.logTextChangeEvent('txt_demo', { text }));
    });
    on('btn_screen_load', () => runBehaviour('Screen load', () => A.logScreenViewContextLoad('demo_screen', 'behaviour')));
    on('btn_screen_unload', () => runBehaviour('Screen unload', () => A.logScreenViewContextUnload('demo_screen', 'behaviour')));
    on('btn_screen_layout', () => runBehaviour('Screen layout', () => A.logScreenLayout('demo_screen')));
    on('btn_log_exception', () => runBehaviour('Exception', () => A.logExceptionEvent(
        'Demo handled exception', 'Error: demo\n    at demo (index.js)', false)));
    on('btn_flush', () => runBehaviour('Flush', () => A.flushQueues()));
}

// ── Identity history ───────────────────────────────────────────────────

function addHistory(name, value, signalType) {
    identityHistory.unshift({ name, value, signalType: signalType || 'loggedIn' });
    if (identityHistory.length > MAX_HIST) identityHistory = identityHistory.slice(0, MAX_HIST);
    saveHistory();
    renderHistory();
}

function renderHistory() {
    const card = document.getElementById('historyCard');
    const list = document.getElementById('identityHistory');

    if (identityHistory.length === 0) {
        card.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    card.style.display = ''; // show the card only when there are entries
    list.innerHTML = identityHistory.map((e, i) =>
        '<li class="history-item" data-index="' + i + '">' +
            '<div class="history-left">' +
                '<span class="history-name">' + escHtml(e.name) + '</span>' +
                '<span class="history-signal">' + escHtml(e.signalType) + '</span>' +
            '</div>' +
            '<span class="history-value">' + escHtml(e.value) + '</span>' +
        '</li>',
    ).join('');

    // Tapping a history entry pre-fills the inputs.
    list.querySelectorAll('.history-item').forEach((li) => {
        li.addEventListener('click', () => {
            const entry = identityHistory[parseInt(li.dataset.index, 10)];
            if (!entry) return;
            document.getElementById('et_identifier_name').value = entry.name;
            document.getElementById('et_identifier_value').value = entry.value;
            document.getElementById('identStatus').className = 'ident-status hidden';
        });
    });
}

function saveHistory() {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(identityHistory)); } catch (_) { /* storage may be unavailable */ }
}

function loadHistory() {
    try {
        const raw = localStorage.getItem(HIST_KEY);
        if (raw) identityHistory = JSON.parse(raw);
    } catch (_) { /* a damaged history is just dropped */ }
    renderHistory(); // always call — shows or hides the card
}

// ── Helpers ────────────────────────────────────────────────────────────

function fmt(value) {
    if (value === undefined || value === null) return String(value);
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function log(line) {
    console.log('[AcousticConnect] ' + line);
}

function escHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
