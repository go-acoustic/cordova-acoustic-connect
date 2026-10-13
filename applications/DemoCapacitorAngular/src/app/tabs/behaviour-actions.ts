import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AcousticService } from '../acoustic.service';
import { errorMessage } from '../behaviour-core';

/** Behaviour › Actions: quick analytics calls, each with the outcome in one shared status line. */
@Component({
  selector: 'app-behaviour-actions',
  imports: [FormsModule],
  template: `
    <section class="card">
      <h2 class="card-title">Custom Event</h2>
      <label class="field-label" for="et_event_name">Event Name</label>
      <input class="field-input" id="et_event_name" type="text" autocomplete="off" [(ngModel)]="eventName">
      <button class="action" id="btn_log_custom_event" [disabled]="!enabled()" (click)="act('customEvent')">Log Custom Event</button>
      <button class="action secondary" id="btn_log_signal" [disabled]="!enabled()" (click)="act('signal')">Log Signal (nested JSON)</button>
    </section>

    <section class="card">
      <h2 class="card-title">Click &amp; Text Change</h2>
      <label class="field-label" for="et_text_value">Text</label>
      <input class="field-input" id="et_text_value" type="text" placeholder="Type something" autocomplete="off" [(ngModel)]="text">
      <button class="action" id="btn_log_click" [disabled]="!enabled()" (click)="act('click')">Log Click (btn_demo)</button>
      <button class="action secondary" id="btn_log_text_change" [disabled]="!enabled()" (click)="act('textChange')">Log Text Change (masked)</button>
      <p class="behaviour-body">The text is masked by default: only its length is sent, as X characters.</p>
    </section>

    <section class="card">
      <h2 class="card-title">Screen View</h2>
      <button class="action" id="btn_screen_load" [disabled]="!enabled()" (click)="act('screenLoad')">Log Screen Load</button>
      <button class="action secondary" id="btn_screen_unload" [disabled]="!enabled()" (click)="act('screenUnload')">Log Screen Unload</button>
    </section>

    <section class="card">
      <h2 class="card-title">Exception &amp; Flush</h2>
      <button class="action" id="btn_log_exception" [disabled]="!enabled()" (click)="act('exception')">Log Handled Exception</button>
      <button class="action secondary" id="btn_flush" [disabled]="!enabled()" (click)="act('flush')">Flush Queues</button>
      @if (status()) {
        <p class="ident-status" [class.success]="ok()" [class.error]="!ok()">{{ status() }}</p>
      }
    </section>
  `
})
export class BehaviourActions {
  readonly acoustic = inject(AcousticService);
  readonly enabled = this.acoustic.sdkEnabled;
  readonly status = signal('');
  readonly ok = signal(false);
  eventName = 'demo_event';
  text = '';

  private readonly actions: Record<string, [string, () => Promise<unknown>]> = {
    customEvent: ['Custom event', () => this.acoustic.customEvent(this.eventName.trim(), { source: 'demo', platform: this.acoustic.platform })],
    signal: ['Signal', () => this.acoustic.signal({
      signalContent: { signalType: 'pageview', url: 'https://app.example.com/demo' },
      audience: [{ name: 'Account ID', value: '42' }]
    })],
    click: ['Click', () => this.acoustic.click('btn_demo', { screen: 'behaviour' })],
    textChange: ['Text change', () => this.acoustic.textChange('txt_demo', { text: this.text })],
    screenLoad: ['Screen load', () => this.acoustic.screenLoad('demo_screen', 'behaviour')],
    screenUnload: ['Screen unload', () => this.acoustic.screenUnload('demo_screen', 'behaviour')],
    exception: ['Exception', () => this.acoustic.exception('Demo handled exception', 'Error: demo\n    at demo (behaviour-actions.ts)', false)],
    flush: ['Flush', () => this.acoustic.flushQueues()]
  };

  act(name: string): void {
    const [label, call] = this.actions[name];
    this.run(label, call);
  }

  /** A resolved promise means the SDK queued the event, not that the collector has it. */
  run(label: string, call: () => Promise<unknown>): void {
    call().then(
      () => this.show(true, `${label} queued`),
      (error) => this.show(false, errorMessage(error, `${label} failed`))
    );
  }

  private show(ok: boolean, text: string): void {
    this.ok.set(ok);
    this.status.set(text);
  }
}
