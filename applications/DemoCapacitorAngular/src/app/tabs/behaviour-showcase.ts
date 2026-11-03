import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AcousticService } from '../acoustic.service';
import {
  CONFIG_PROBE, CUSTOM_EVENT, DirectResult, FEATURES, FLAT_SIGNAL, GESTURE_REFERRER, GESTURE_SCREEN, MAX_DEPTH, NESTED_SIGNAL, closeScreen,
  errorMessage, gestureLabel, gestureRows, maskPreview, openScreen, runDirectCases
} from '../behaviour-core';
import { createGestureHandlers } from './behaviour-gestures';

interface Line { ok: boolean; text: string }

/** Behaviour › Showcase: one card per analytics feature. */
@Component({
  selector: 'app-behaviour-showcase',
  imports: [FormsModule],
  template: `
    @if (gestures()) {
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
    } @else if (!detail()) {
      @for (f of features; track f.id) {
        <section class="card">
          <h2 class="card-title">{{ f.title }}</h2>
          <p class="card-text">{{ f.description }}</p>

          @switch (f.id) {
            @case ('taps') {
              <p class="card-text">Taps: {{ taps() }}</p>
              <button class="action" [disabled]="!enabled()" (click)="tap()">Tap</button>
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
            @case ('custom-event') {
              <p class="card-meta">{{ customEventValues }} · level {{ customEventLevel }}</p>
              <button class="action" [disabled]="!enabled()" (click)="act('custom-event')">Log custom event</button>
            }
            @case ('signal') {
              <button class="action" [disabled]="!enabled()" (click)="act('signal-nested')">Log nested signal</button>
              <button class="action secondary" [disabled]="!enabled()" (click)="act('signal-flat')">Log flat signal</button>
            }
            @case ('exception') {
              <button class="action" [disabled]="!enabled()" (click)="act('exception')">Log handled exception</button>
            }
            @case ('screen-view') {
              <button class="action" [disabled]="!enabled()" (click)="openDetail()">Open screen view chain</button>
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
    } @else {
      <section class="card">
        <h2 class="card-title">Screen view chain</h2>
        <p class="card-text">{{ chain().length ? chain().join(' › ') : 'No screen open' }}</p>
        <p class="card-meta">Depth {{ chain().length }} of {{ maxDepth }}</p>
        <button class="action" [disabled]="!enabled()" (click)="openNext()">Open next screen</button>
        <button class="action secondary" [disabled]="!enabled()" (click)="closeTop()">Close top screen</button>
        <button class="action link" (click)="detail.set(false)">‹ Back to Showcase</button>
        @if (lines()['chain']; as line) {
          <p class="result-line" [class.success]="line.ok" [class.error]="!line.ok">{{ line.text }}</p>
        }
      </section>
    }
  `
})
export class BehaviourShowcase {
  readonly acoustic = inject(AcousticService);
  readonly enabled = this.acoustic.sdkEnabled;
  readonly features = FEATURES;
  readonly maxDepth = MAX_DEPTH;
  readonly nestedSignal = NESTED_SIGNAL;
  readonly flatSignal = FLAT_SIGNAL;
  readonly customEventName = CUSTOM_EVENT.name;
  readonly customEventData = CUSTOM_EVENT.values;
  readonly customEventLevel = CUSTOM_EVENT.level;
  readonly customEventValues = JSON.stringify(CUSTOM_EVENT.values);
  readonly taps = signal(0);
  readonly lines = signal<Record<string, Line>>({});
  readonly detail = signal(false);
  readonly gestures = signal(false);
  readonly lastGesture = signal(gestureLabel());
  readonly zoom = signal(1);
  readonly rows = gestureRows();
  handlers = this.newGestureHandlers();
  readonly chain = signal<string[]>([]);
  readonly directResults = signal<DirectResult[]>([]);
  readonly configOut = signal('');
  text = '';
  configKey = CONFIG_PROBE.key;
  configValue = CONFIG_PROBE.value;
  configModule = CONFIG_PROBE.module;

  private readonly actions: Record<string, [string, () => Promise<unknown>, string?]> = {
    'text-masked': ['text', () => this.acoustic.textChange('showcase_txt', { text: this.text })],
    'text-plain': ['text', () => this.acoustic.textChange('showcase_txt', { text: this.text, masked: false })],
    'custom-event': ['custom-event', () => this.acoustic.customEvent(this.customEventName, this.customEventData, this.customEventLevel)],
    'signal-nested': ['signal', () => this.acoustic.signal(this.nestedSignal)],
    'signal-flat': ['signal', () => this.acoustic.signal(this.flatSignal)],
    'exception': ['exception', () => this.acoustic.exception('Showcase handled exception', 'Error: showcase\n    at showcase (behaviour-showcase.ts)', false)],
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

  tap(): void {
    this.taps.update((n) => n + 1);
    this.run('taps', () => this.acoustic.click('showcase_tap', { count: this.taps() }));
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

  openDetail(): void {
    this.chain.set([]);
    this.lines.update(({ chain, ...rest }) => rest);
    this.detail.set(true);
  }

  openGestures(): void {
    this.lastGesture.set(gestureLabel());
    this.zoom.set(1);
    this.lines.update(({ 'gestures-screen': screenLine, ...rest }) => rest);
    this.handlers = this.newGestureHandlers();
    this.gestures.set(true);
    this.run('gestures-screen', () => this.acoustic.screenLoad(GESTURE_SCREEN, GESTURE_REFERRER));
  }

  closeGestures(): void {
    this.gestures.set(false);
    this.run('gestures-screen', () => this.acoustic.screenUnload(GESTURE_SCREEN, GESTURE_REFERRER));
  }

  /** Each "next" screen loads with the previous one as referrer. */
  openNext(): void {
    const r = openScreen(this.chain(), 'Screen ' + (this.chain().length + 1));
    if (r.blocked || !r.load) {
      this.line('chain', false, 'Maximum depth reached');
      return;
    }
    this.chain.set(r.chain);
    this.run('chain', () => this.acoustic.screenLoad(r.load!.name, r.load!.referrer));
  }

  closeTop(): void {
    const r = closeScreen(this.chain());
    if (!r.unload) {
      this.line('chain', false, 'No screen to close');
      return;
    }
    this.chain.set(r.chain);
    this.run('chain', () => this.acoustic.screenUnload(r.unload!.name, r.unload!.referrer));
  }

  private newGestureHandlers() {
    return createGestureHandlers((name) => this.lastGesture.set(gestureLabel(name)), (zoom) => this.zoom.set(zoom));
  }

  private line(id: string, ok: boolean, text: string): void {
    this.lines.update((l) => ({ ...l, [id]: { ok, text } }));
  }
}
