import { Component, inject, signal } from '@angular/core';
import { AcousticService } from '../acoustic.service';
import {
  CUSTOM_EVENT, FLAT_SIGNAL, NESTED_SIGNAL, SIGNAL_LEVEL, attempt, customEventLine, identityLine, signalLine
} from '../behaviour-core';
import type { CallOutcome } from '../behaviour-core';
import type { SignalValues } from 'capacitor-acoustic-connect-beta';

interface Line { ok: boolean; text: string }

/*
 * The bodies the Showcase and the Verification sub-tab share, as on the React Native samples: the same ids, labels and result texts
 * (behaviour-core.ts), each result on a line that exists once the button has been pressed.
 */

/** The custom event of the sample UI contract. */
@Component({
  selector: 'app-custom-event-body',
  template: `
    <p class="card-meta">{{ values }} · level {{ level }}</p>
    <button class="action" id="btn_send_custom_event" [disabled]="!acoustic.sdkEnabled()" (click)="send()">Send custom event</button>
    @if (line(); as l) {
      <p class="result-line" id="txt_custom_event_result" [class.success]="l.ok" [class.error]="!l.ok">{{ l.text }}</p>
    }
  `
})
export class CustomEventBody {
  readonly acoustic = inject(AcousticService);
  readonly values = JSON.stringify(CUSTOM_EVENT.values);
  readonly level = CUSTOM_EVENT.level;
  readonly line = signal<Line | null>(null);

  async send(): Promise<void> {
    const outcome = await attempt(() => this.acoustic.customEvent(CUSTOM_EVENT.name, CUSTOM_EVENT.values, CUSTOM_EVENT.level));
    this.line.set({ ok: outcome.ok, text: customEventLine(outcome) });
  }
}

/** The nested and the flat signal of the sample UI contract. */
@Component({
  selector: 'app-signal-body',
  template: `
    <button class="action" id="btn_send_nested_signal" [disabled]="!acoustic.sdkEnabled()" (click)="send('nested', nested)">Send nested signal</button>
    <button class="action secondary" id="btn_send_flat_signal" [disabled]="!acoustic.sdkEnabled()" (click)="send('flat', flat)">Send flat signal</button>
    @if (line(); as l) {
      <p class="result-line" id="txt_signal_result" [class.success]="l.ok" [class.error]="!l.ok">{{ l.text }}</p>
    }
  `
})
export class SignalBody {
  readonly acoustic = inject(AcousticService);
  readonly nested = NESTED_SIGNAL;
  readonly flat = FLAT_SIGNAL;
  readonly line = signal<Line | null>(null);

  async send(label: string, payload: SignalValues): Promise<void> {
    const outcome = await attempt(() => this.acoustic.signal(payload, SIGNAL_LEVEL));
    this.line.set({ ok: outcome.ok, text: signalLine(label, payload, outcome) });
  }
}

/** Identity with both optional arguments left out (the plugin's own defaults under test), and with an explicit signal type. */
@Component({
  selector: 'app-identity-defaults-body',
  template: `
    <button class="action" id="btn_identity_defaulted" [disabled]="!acoustic.sdkEnabled()" (click)="defaulted()">Log identity — omit both optional args</button>
    <button class="action secondary" id="btn_identity_explicit" [disabled]="!acoustic.sdkEnabled()" (click)="explicit()">Log accountRegistered — explicit</button>
    @if (line(); as l) {
      <p class="result-line" id="txt_identity_defaults_result" [class.success]="l.ok" [class.error]="!l.ok">{{ l.text }}</p>
    }
  `
})
export class IdentityDefaultsBody {
  readonly acoustic = inject(AcousticService);
  readonly line = signal<Line | null>(null);

  defaulted(): Promise<void> {
    return this.log('defaulted', () => this.acoustic.identity('Email', 'defaults@example.com'));
  }

  explicit(): Promise<void> {
    return this.log('explicit', () =>
      this.acoustic.identity('Email', 'explicit@example.com', 'accountRegistered', { registrationMethod: 'email' }));
  }

  private async log(kind: 'defaulted' | 'explicit', call: () => Promise<unknown>): Promise<void> {
    const outcome: CallOutcome = await attempt(call);
    this.line.set({ ok: outcome.ok, text: identityLine(kind, outcome) });
  }
}
