import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AcousticService } from '../acoustic.service';
import {
  CONFIG_PROBE, DirectResult, FEATURES, GESTURE_SCREEN, MAX_DEPTH, ScreenOutcome,
  attempt, captureLine, detailScreen, errorMessage, exceptionLine, gestureLabel, gestureRows, handledException, maskPreview,
  runDirectCases, tapsLine, viewFor
} from '../behaviour-core';
import { CustomEventBody, SignalBody } from './behaviour-contract-bodies';
import { createGestureHandlers } from './behaviour-gestures';

interface Line { ok: boolean; text: string }

/** Behaviour › Showcase: one card per analytics feature. */
@Component({
  selector: 'app-behaviour-showcase',
  imports: [FormsModule, CustomEventBody, SignalBody],
  template: `
    @if (view()?.kind === 'gestures') {
      <section class="card">
        <h2 class="card-title">Gestures</h2>
        <p class="card-text" id="tv_gestures_last">{{ lastGesture() }}</p>
        <div class="gesture-surface gesture-target gesture-taps" id="gesture_long_press" (contextmenu)="$event.preventDefault()"
             (pointerdown)="handlers.longPress.down($event)" (pointermove)="handlers.longPress.move($event)"
             (pointerup)="handlers.longPress.up($event)" (pointercancel)="handlers.longPress.cancel($event)">Long press me</div>
        <div class="gesture-surface gesture-target gesture-taps" id="gesture_double_tap" (contextmenu)="$event.preventDefault()"
             (pointerdown)="handlers.doubleTap.down($event)" (pointermove)="handlers.doubleTap.move($event)"
             (pointerup)="handlers.doubleTap.up($event)" (pointercancel)="handlers.doubleTap.cancel($event)">Double tap me</div>
        <div class="gesture-surface gesture-target gesture-claims" id="gesture_swipe" (contextmenu)="$event.preventDefault()"
             (pointerdown)="handlers.swipe.down($event)" (pointermove)="handlers.swipe.move($event)"
             (pointerup)="handlers.swipe.up($event)" (pointercancel)="handlers.swipe.cancel($event)">Swipe me — any direction</div>
        <div class="gesture-surface gesture-pinch gesture-claims" id="gesture_pinch_zoom" (contextmenu)="$event.preventDefault()"
             (pointerdown)="handlers.pinch.down($event)" (pointermove)="handlers.pinch.move($event)"
             (pointerup)="handlers.pinch.up($event)" (pointercancel)="handlers.pinch.cancel($event)">
          <div class="gesture-pinch-inner" [style.transform]="'scale(' + zoom() + ')'">Pinch to zoom</div>
        </div>
        <ul class="gesture-list" id="gesture_scroll_list">
          @for (row of rows; track row.id) {
            <li class="gesture-row" [id]="row.id">{{ row.text }}</li>
          }
        </ul>
        <button class="action link" id="btn_gestures_back" (click)="closeGestures()">‹ Back to Showcase</button>
        @if (lines()['gestures-screen']; as line) {
          <p class="result-line" [class.success]="line.ok" [class.error]="!line.ok">{{ line.text }}</p>
        }
      </section>
    } @else if (detail(); as depth) {
      <section class="card">
        <h2 class="card-title">{{ detailName(depth) }}</h2>
        <p class="card-text">Opening this screen logged a screen view named:</p>
        <p class="card-text mono">{{ detailName(depth) }}</p>
        <p class="card-text">The referrer is the screen you navigated from. Going back logs the previous screen again, with this one as its referrer.</p>
      </section>
      <section class="card">
        <h2 class="card-title">Referrer chain</h2>
        <p class="card-text">Push another detail screen to see the chain advance by one, then pop back through it. Depth {{ depth }} of {{ maxDepth }}.</p>
        <button class="action" id="btn_showcase_push_detail" [disabled]="depth >= maxDepth" (click)="pushDetail(depth)">{{ depth >= maxDepth ? 'Chain limit reached' : 'Push another' }}</button>
        <button class="action secondary" id="btn_showcase_back" (click)="back()">Back</button>
      </section>
    } @else {
      @for (f of features; track f.id) {
        <section class="card">
          <h2 class="card-title">{{ f.title }}</h2>
          <p class="card-text">{{ f.description }}</p>

          @switch (f.id) {
            @case ('taps') {
              <button class="action" id="btn_showcase_tap" (click)="taps.set(taps() + 1)">Tap me</button>
              <p class="card-text" id="txt_showcase_taps">{{ tapsText() }}</p>
            }
            @case ('gestures') {
              <button class="action secondary" id="btn_open_gestures" [disabled]="!enabled()" (click)="openGestures()">Open Gestures</button>
            }
            @case ('text') {
              <input class="field-input" type="text" placeholder="Type something" autocomplete="off" [(ngModel)]="text">
              <p class="card-meta">Sent as: {{ preview() }}</p>
              <button class="action" [disabled]="!enabled()" (click)="act('text-masked')">Log text (masked)</button>
              <button class="action secondary" [disabled]="!enabled()" (click)="act('text-plain')">Log text (plain)</button>
            }
            @case ('text-capture') {
              <div class="text-field">
                <label class="field-label" for="field_showcase_note">Plain field</label>
                <input class="field-input" id="field_showcase_note" type="text" autocomplete="off" placeholder="Anything you type is captured">
              </div>
              <div class="text-field">
                <label class="field-label" for="field_showcase_secret">Masked field</label>
                <input class="field-input" id="field_showcase_secret" type="text" autocomplete="off" placeholder="SECRET-1234">
              </div>
            }
            @case ('custom-event') {
              <app-custom-event-body />
            }
            @case ('signal') {
              <app-signal-body />
            }
            @case ('exception') {
              <button class="action" id="btn_showcase_exception" [disabled]="!enabled()" (click)="reportException()">Log a handled exception</button>
              @if (exception(); as line) {
                <p class="result-line" id="txt_showcase_exception_result" [class.success]="line.ok" [class.error]="!line.ok">{{ line.text }}</p>
              }
            }
            @case ('capture') {
              <button class="action" id="btn_capture_disable" (click)="capture('disable')">Disable SDK</button>
              <button class="action" id="btn_capture_enable" (click)="capture('enable')">Re-enable SDK</button>
              @if (captureState(); as line) {
                <p class="result-line" id="txt_capture_state" [class.success]="line.ok" [class.error]="!line.ok">{{ line.text }}</p>
              }
            }
            @case ('screen-view') {
              <button class="action" id="btn_showcase_open_detail" (click)="openDetail()">Open a detail screen</button>
              <button class="action secondary" [disabled]="!enabled()" (click)="direct()">Direct names</button>
              @if (directResults().length) {
                <ul class="result-log">
                  @for (r of directResults(); track r.id) {
                    <li>{{ r.ok ? '✓ ' : '✗ ' }}{{ r.shown }}{{ r.ok ? '' : ' — ' + r.message }}</li>
                  }
                </ul>
              }
            }
            @case ('identity') {
              <button class="action" [disabled]="!enabled()" (click)="act('identity-default')">Default signal type</button>
              <button class="action secondary" [disabled]="!enabled()" (click)="act('identity-explicit')">Explicit signal type</button>
            }
            @case ('config') {
              <p class="card-meta">Key · value · module (iOS ignores the module)</p>
              <input class="field-input" type="text" autocomplete="off" [(ngModel)]="configKey">
              <input class="field-input" type="text" autocomplete="off" [(ngModel)]="configValue">
              <input class="field-input" type="text" autocomplete="off" [(ngModel)]="configModule">
              <button class="action" [disabled]="!enabled()" (click)="act('config-set')">Set item</button>
              <button class="action secondary" [disabled]="!enabled()" (click)="getItem()">Get item</button>
              @if (configOut()) { <p class="card-meta">{{ configOut() }}</p> }
            }
            @case ('sdk') {
              <button class="action" (click)="act('sdk-version')">getSdkVersion</button>
              <button class="action secondary" (click)="act('sdk-enabled')">isSdkEnabled</button>
              <button class="action secondary" [disabled]="!enabled()" (click)="act('sdk-log-level')">setLogLevel verbose</button>
              <button class="action secondary" (click)="act('sdk-enable')">enable (key in acoustic-demo.config.ts)</button>
              <button class="action secondary" [disabled]="!enabled()" (click)="act('sdk-disable')">disable</button>
            }
            @case ('push-manual') {
              <button class="action" (click)="act('push-authorization')">didReceiveAuthorization</button>
              <button class="action secondary" (click)="act('push-token')">didRegisterWithToken</button>
              <button class="action secondary" (click)="act('push-fail')">didFailToRegister</button>
              <button class="action secondary" (click)="act('push-notification')">didReceiveNotification</button>
              <button class="action secondary" (click)="act('push-response')">didReceiveResponse</button>
            }
          }

          @if (lines()[f.id]; as line) {
            <p class="result-line" [class.success]="line.ok" [class.error]="!line.ok">{{ line.text }}</p>
          }
        </section>
      }
    }
  `
})
export class BehaviourShowcase {
  readonly acoustic = inject(AcousticService);
  readonly enabled = this.acoustic.sdkEnabled;
  readonly features = FEATURES;
  readonly maxDepth = MAX_DEPTH;
  readonly taps = signal(0);
  readonly tapsText = computed(() => tapsLine(this.taps()));
  readonly lines = signal<Record<string, Line>>({});
  readonly exception = signal<Line | null>(null);
  readonly captureState = signal<Line | null>(null);
  /** The view on top of the Showcase's stack (kept in the service, so it outlives this component), null on the list of cards. */
  readonly view = computed(() => {
    const stack = this.acoustic.views()['showcase'] ?? [];
    return stack.length ? viewFor(stack[stack.length - 1]) : null;
  });
  readonly detail = computed(() => {
    const view = this.view();
    return view?.kind === 'detail' ? view.depth : null;
  });
  readonly lastGesture = signal(gestureLabel());
  readonly zoom = signal(1);
  readonly rows = gestureRows();
  handlers = this.newGestureHandlers();
  readonly directResults = signal<DirectResult[]>([]);
  readonly configOut = signal('');
  text = '';
  configKey = CONFIG_PROBE.key;
  configValue = CONFIG_PROBE.value;
  configModule = CONFIG_PROBE.module;

  private readonly actions: Record<string, [string, () => Promise<unknown>, string?]> = {
    'text-masked': ['text', () => this.acoustic.textChange('showcase_txt', { text: this.text })],
    'text-plain': ['text', () => this.acoustic.textChange('showcase_txt', { text: this.text, masked: false })],
    'identity-default': ['identity', () => this.acoustic.identity('Email', 'defaults@example.com')],
    'identity-explicit': ['identity', () => this.acoustic.identity('Email', 'explicit@example.com', 'accountRegistered', { registrationMethod: 'email' })],
    'config-set': ['config', () => this.acoustic.setConfigItem(this.configKey, this.configValue, this.configModule)],
    'sdk-version': ['sdk', () => this.acoustic.getSdkVersion(), 'Version'],
    'sdk-enabled': ['sdk', () => this.acoustic.isSdkEnabled(), 'Enabled'],
    'sdk-log-level': ['sdk', () => this.acoustic.setLogLevel('verbose')],
    'sdk-enable': ['sdk', () => this.acoustic.enable()],
    'sdk-disable': ['sdk', () => this.acoustic.disable()],
    'push-authorization': ['push-manual', () => this.acoustic.pushDidReceiveAuthorization()],
    'push-token': ['push-manual', () => this.acoustic.pushDidRegisterWithToken()],
    'push-fail': ['push-manual', () => this.acoustic.pushDidFailToRegister()],
    'push-notification': ['push-manual', () => this.acoustic.pushDidReceiveNotification()],
    'push-response': ['push-manual', () => this.acoustic.pushDidReceiveResponse()]
  };

  act(key: string): void {
    const [id, call, label] = this.actions[key];
    this.run(id, call, label);
  }

  preview(): string {
    return maskPreview(this.text);
  }

  /** Runs one call and shows "Queued" (the SDK accepted the message), the result, or the error on the card's result line. */
  run(id: string, call: () => Promise<unknown>, label = 'Queued'): void {
    Promise.resolve().then(call).then(
      (value) => this.line(id, true, value === undefined ? label : `${label}: ${JSON.stringify(value)}`),
      (error) => this.line(id, false, errorMessage(error))
    );
  }

  async reportException(): Promise<void> {
    const report = handledException();
    const outcome = await attempt(() => this.acoustic.exception(report.message, report.stack, false));
    this.exception.set({ ok: outcome.ok, text: exceptionLine(outcome) });
  }

  /** disable() and enable() also start and stop the page's screen views (AcousticService). */
  async capture(method: 'disable' | 'enable'): Promise<void> {
    const outcome = await attempt(() => (method === 'enable' ? this.acoustic.enable() : this.acoustic.disable()));
    this.captureState.set({ ok: outcome.ok, text: captureLine(method, outcome) });
  }

  getItem(): void {
    this.run('config', async () => {
      const value = await this.acoustic.getConfigItem(this.configKey, '', this.configModule);
      this.configOut.set('Value: ' + JSON.stringify(value));
    });
  }

  direct(): void {
    this.run('screen-view', async () => this.directResults.set(await runDirectCases(this.acoustic.plugin)));
  }

  /** The detail chain: Showcase detail, then Showcase detail 2 to 5, each loaded with the previous one as referrer. */
  openDetail(): void {
    this.acoustic.openView('showcase', detailScreen(1));
  }

  pushDetail(depth: number): void {
    if (depth < MAX_DEPTH) this.acoustic.openView('showcase', detailScreen(depth + 1));
  }

  back(): void {
    this.acoustic.closeView('showcase');
  }

  detailName(depth: number): string {
    return detailScreen(depth);
  }

  openGestures(): void {
    this.lastGesture.set(gestureLabel());
    this.zoom.set(1);
    this.lines.update(({ 'gestures-screen': screenLine, ...rest }) => rest);
    this.handlers = this.newGestureHandlers();
    this.screenLine(this.acoustic.openView('showcase', GESTURE_SCREEN).load);
  }

  closeGestures(): void {
    this.screenLine(this.acoustic.closeView('showcase').unload);
  }

  private screenLine(step: Promise<ScreenOutcome> | null): void {
    step?.then((outcome) => this.line('gestures-screen', outcome.ok, outcome.ok ? 'Queued' : outcome.message ?? 'failed'));
  }

  private newGestureHandlers() {
    return createGestureHandlers((name) => this.lastGesture.set(gestureLabel(name)), (zoom) => this.zoom.set(zoom));
  }

  private line(id: string, ok: boolean, text: string): void {
    this.lines.update((l) => ({ ...l, [id]: { ok, text } }));
  }
}
