import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AcousticService } from '../acoustic.service';
import { errorMessage } from '../behaviour-core';

const MAX_HIST = 5;
const HIST_KEY = 'acoustic_identity_history';

interface HistoryEntry { name: string; value: string; signalType: string }

/** The Identity tab: log an identity signal (logged in, account registered) and keep the last five. */
@Component({
  selector: 'app-identity-tab',
  imports: [FormsModule],
  template: `
    <section class="card">
      <h2 class="card-title">Log Identity</h2>
      <label class="field-label" for="et_identifier_name">Identifier Name</label>
      <input class="field-input" id="et_identifier_name" type="text" placeholder="e.g. Email" autocomplete="off" [(ngModel)]="name">
      <label class="field-label" for="et_identifier_value">Identifier Value</label>
      <input class="field-input" id="et_identifier_value" type="text" placeholder="e.g. user@example.com" autocomplete="off" [(ngModel)]="value">
      <button class="action" id="btn_send_identity_signal" [disabled]="!acoustic.sdkEnabled()" (click)="send('loggedIn', { loginMethod: 'email' })">Log Logged In With Email</button>
      <button class="action" id="btn_send_account_registered_signal" [disabled]="!acoustic.sdkEnabled()" (click)="send('accountRegistered', { registrationMethod: 'email' })">Log Account Registered With Email</button>
      @if (status()) {
        <p class="ident-status" [class.error]="!statusOk()" [class.success]="statusOk()">{{ status() }}</p>
      }
    </section>

    @if (history().length) {
      <section class="card">
        <h2 class="card-title">Recent</h2>
        <ul class="history-list">
          @for (e of history(); track $index) {
            <li class="history-item" (click)="fill(e)">
              <div class="history-left">
                <span class="history-name">{{ e.name }}</span>
                <span class="history-signal">{{ e.signalType }}</span>
              </div>
              <span class="history-value">{{ e.value }}</span>
            </li>
          }
        </ul>
      </section>
    }
  `
})
export class IdentityTab {
  readonly acoustic = inject(AcousticService);
  readonly history = signal<HistoryEntry[]>(this.load());
  readonly status = signal('');
  readonly statusOk = signal(false);
  name = '';
  value = '';

  send(signalType: string, additionalParameters: Record<string, unknown>): void {
    const name = this.name.trim();
    const value = this.value.trim();
    if (!name || !value) {
      this.show(false, 'Identifier name and value cannot be empty');
      return;
    }
    this.status.set('');
    this.acoustic.identity(name, value, signalType, additionalParameters).then(
      () => {
        this.show(true, 'Identity signal was sent');
        this.add({ name, value, signalType });
      },
      (error) => this.show(false, errorMessage(error, 'Failed to send identity signal'))
    );
  }

  /** Tapping a history entry pre-fills the inputs. */
  fill(entry: HistoryEntry): void {
    this.name = entry.name;
    this.value = entry.value;
    this.status.set('');
  }

  private show(ok: boolean, text: string): void {
    this.statusOk.set(ok);
    this.status.set(text);
  }

  private add(entry: HistoryEntry): void {
    const next = [entry, ...this.history()].slice(0, MAX_HIST);
    this.history.set(next);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  }

  private load(): HistoryEntry[] {
    try {
      const raw = localStorage.getItem(HIST_KEY);
      return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
      return []; // a damaged history is just dropped
    }
  }
}
