/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Internal demo for the Acoustic Connect Cordova plugin.
 * Three tabs — Notification, Identity, Behaviour.
 */

'use strict';

const SERVICE    = 'ConnectPlugin';
const CONFIG     = window.ConnectBasicConfig || {};
const MAX_HIST   = 5;
const HIST_KEY   = 'acoustic_identity_history';

let identityHistory = [];

// Persists notification permission state across SDK-triggered WebView reloads.
const SS_PERM = 'ac_perm';

document.addEventListener('deviceready', onDeviceReady, false);

function onDeviceReady() {
    const status = document.getElementById('deviceready');
    status.textContent = 'Device ready · cordova-' + cordova.platformId + '@' + cordova.version;
    status.classList.add('ready');

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // ── Notification tab ────────────────────────────────────────────
    document.getElementById('btnEnablePush').addEventListener('click', () => {
        exec('pushRequestPermission', [], (result) => {
            const granted = result && (result.granted === true || result.granted === 'true');
            updateAuthStatus(
                granted,
                granted ? 'Push notifications are enabled' : 'Push notifications permission denied'
            );
        }, (error) => {
            updateAuthStatus(false, 'Error: ' + (typeof error === 'string' ? error : JSON.stringify(error)));
        });
    });

    // Mirrors the React Native bare-workflow demo's AppState 'active' listener:
    // re-check permission state every time the app comes to foreground so the
    // badge stays accurate after the SDK auto-shows the Android 13+ system
    // permission dialog (fire-and-forget from handleEnable, no JS callback).
    document.addEventListener('resume', refreshPermissionState, false);

    // ── Identity tab ────────────────────────────────────────────────
    document.getElementById('btnLogLoggedIn').addEventListener('click', logUserLoggedIn);
    document.getElementById('btnLogRegistered').addEventListener('click', logUserRegistered);

    loadHistory();
    restoreSession();
    initSdk();
}

// ── SDK initialisation ─────────────────────────────────────────────────

// Enables the SDK from the bundled config.
// Mirrors ConnectSDKManager.start() in the React Native bare-workflow demo.
function initSdk() {
    const appKey  = CONFIG.AppKey;
    const postURL = CONFIG.PostMessageUrl;
    if (!appKey || !postURL) {
        log('ConnectBasicConfig missing AppKey or PostMessageUrl — SDK not initialised');
        return;
    }

    const pushMode = cordova.platformId === 'android'
        ? 'automatic'
        : (CONFIG.iOSPushMode === 'manual' ? 'manual' : 'automatic');

    const pushOptions = cordova.platformId === 'android'
        ? { androidIconResName: CONFIG.AndroidIconResName || null }
        : { iosAppGroupIdentifier: CONFIG.iOSAppGroupIdentifier || null };

    exec('enable', [appKey, postURL, pushMode, pushOptions], onSdkEnabled, (error) => {
        log('SDK enable failed: ' + fmt(error));
        updateAuthStatus(false, 'Error: SDK failed to initialise — ' + fmt(error));
    });
}

// Called when enable() completes (Android: turnOnPush succeeded; iOS: SDK ready).
// Push is configured — enable all buttons and read current permission state.
function onSdkEnabled() {
    document.getElementById('btnLogLoggedIn').disabled  = false;
    document.getElementById('btnLogRegistered').disabled = false;
    document.getElementById('btnEnablePush').disabled   = false;
    refreshPermissionState();
}

// ── Push permission state ──────────────────────────────────────────────

// Reads OS notification permission and updates the auth badge only.
// The Enable Push button state is controlled by onSdkEnabled() — it stays
// enabled regardless of the current permission state so the user can always
// re-request from the Authorized or Not Authorized status.
//
// Called: after initSdk(), on every app resume (Android 13+ auto-dialog fix).
function refreshPermissionState() {
    exec('pushGetPermissionState', [], (state) => {
        if (state === true || state === 1) {
            updateAuthStatus(true, 'Push notifications are enabled');
        } else if (state === false) {
            updateAuthStatus(false, 'Push notifications permission denied');
        }
        // null = NOT_DETERMINED: badge stays at default "Not Authorized".
    });
}

// ── Tab switching ──────────────────────────────────────────────────────

const TAB_TITLES = { notification: 'Push', identity: 'Identity', behaviour: 'Behaviour' };

function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = TAB_TITLES[tab] || tab;
    // Mirror the Android demo screen names: notification_screen / identity_screen
    exec('setCurrentScreenName', [tab + '_screen']);
}

// ── Session restore ────────────────────────────────────────────────────

// Restores the permission badge from sessionStorage after an SDK-triggered
// WebView reload so the UI remains consistent without a full re-init cycle.
function restoreSession() {
    try {
        const perm = sessionStorage.getItem(SS_PERM);
        if (perm !== null) updateAuthStatus(perm === 'true');
    } catch (_) {}
}

// ── Notification Authorization ─────────────────────────────────────────

// Updates the Notification Authorization card — mirrors the Android demo and
// the React Native PushScreen: green dot + "Status: Authorized" when granted.
function updateAuthStatus(authorized, message) {
    const dot  = document.getElementById('authDot');
    const text = document.getElementById('authStatusText');
    const msg  = document.getElementById('authMessage');

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

    try { sessionStorage.setItem(SS_PERM, authorized ? 'true' : 'false'); } catch (_) {}
}

// ── Identity tab actions ───────────────────────────────────────────────

function logUserLoggedIn() {
    sendIdentitySignal('loggedIn', { loginMethod: 'email' });
}

function logUserRegistered() {
    sendIdentitySignal('accountRegistered', { registrationMethod: 'email' });
}

function sendIdentitySignal(signalType, additionalParameters) {
    const name    = document.getElementById('identName').value.trim();
    const value   = document.getElementById('identValue').value.trim();
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
             const msg = (error && error.message) ? error.message : 'Failed to send identity signal';
             statusEl.textContent = msg;
             statusEl.className = 'ident-status error';
        });
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

    card.style.display = '';   // show the card only when there are entries
    list.innerHTML = identityHistory.map((e, i) =>
        '<li class="history-item" data-index="' + i + '">' +
            '<div class="history-left">' +
                '<span class="history-name">'   + escHtml(e.name)       + '</span>' +
                '<span class="history-signal">' + escHtml(e.signalType) + '</span>' +
            '</div>' +
            '<span class="history-value">' + escHtml(e.value) + '</span>' +
        '</li>'
    ).join('');

    // Tapping a history entry pre-fills the inputs — mirrors Android demo.
    list.querySelectorAll('.history-item').forEach(li => {
        li.addEventListener('click', () => {
            const entry = identityHistory[parseInt(li.dataset.index, 10)];
            if (!entry) return;
            document.getElementById('identName').value  = entry.name;
            document.getElementById('identValue').value = entry.value;
            document.getElementById('identStatus').className = 'ident-status hidden';
        });
    });
}

function saveHistory() {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(identityHistory)); } catch (_) {}
}

function loadHistory() {
    try {
        const raw = localStorage.getItem(HIST_KEY);
        if (raw) identityHistory = JSON.parse(raw);
    } catch (_) {}
    renderHistory(); // always call — shows or hides the card
}

// ── Core exec / log helpers ────────────────────────────────────────────

function exec(action, args, onSuccess, onError) {
    cordova.exec(
        (result) => { if (onSuccess) onSuccess(result); },
        (error)  => {
            log('✗ ' + action + ' → ' + fmt(error));
            if (onError) onError(error);
        },
        SERVICE,
        action,
        args
    );
}

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
