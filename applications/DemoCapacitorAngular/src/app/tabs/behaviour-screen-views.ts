import { Component, inject, input, linkedSignal, signal } from '@angular/core';
import { AcousticService } from '../acoustic.service';
import {
  DIRECT_SCREEN_CASES, NAV_CASES, ScreenViewCase, ScreenViewEntry, addScreenViewEntry, attempt, describeName,
  nextCase, reloggedLine, screenViewLine, sendAllScreenViews, sendScreenView
} from '../behaviour-core';

interface Line { ok: boolean; text: string }

/**
 * Behaviour › Verification › Screen Views: a view per navigable case, opened through the page's screen tracker, and direct screen views
 * with exact names. The view is on the Verification stack (AcousticService), so it is the one shown when the tab comes back.
 */
@Component({
  selector: 'app-screen-views',
  template: `
    <div class="view-header">
      <button class="action link" id="btn_screen_views_back" (click)="acoustic.closeView('verification')">‹ Back</button>
      <h2 class="card-title">Screen Views</h2>
    </div>

    <section class="card">
      <h2 class="card-title">Navigate — real integration path</h2>
      <p class="card-text">Opens a view named exactly as the case, logged through the page's screen tracker with the screen left as referrer. Go back and re-enter to produce repeat views.</p>
      @for (c of navCases; track c.id) {
        <div class="case-block">
          <button class="action secondary" [id]="'btn_navigate_' + c.id" (click)="acoustic.enterCase(c.name ?? '')">{{ c.label }}</button>
          <p class="card-meta">logs: {{ describe(c) }}</p>
        </div>
      }
    </section>

    <section class="card">
      <h2 class="card-title">Screen view — exact name</h2>
      <p class="card-text">Sends a screen view with exactly the name below, with the referrer "Screen View Diagnostics", straight to the plugin. The empty and the null name are only reachable here; the plugin refuses blank and null names, and the refusal is the result.</p>
      <button class="action" id="btn_screenview_send_all" [disabled]="!acoustic.sdkEnabled()" (click)="sendAll()">Send all {{ directCases.length }} names</button>
      @for (c of directCases; track c.id) {
        <button class="action secondary" [id]="'btn_screenview_' + c.id" [disabled]="!acoustic.sdkEnabled()" (click)="send(c)">{{ c.label }}</button>
      }
      <div class="result-log">
        @for (entry of log(); track $index) {
          <p class="result-line" [attr.id]="$first ? 'txt_screenview_result' : null" [class.success]="entry.ok" [class.error]="!entry.ok">{{ lineText(entry) }}</p>
        }
      </div>
    </section>
  `
})
export class BehaviourScreenViews {
  readonly acoustic = inject(AcousticService);
  readonly navCases = NAV_CASES;
  readonly directCases = DIRECT_SCREEN_CASES;
  /** The latest outcome first (addScreenViewEntry keeps the latest 12). */
  readonly log = signal<ScreenViewEntry[]>([]);

  describe(c: ScreenViewCase): string {
    return describeName(c.name);
  }

  lineText(entry: ScreenViewEntry): string {
    return screenViewLine(entry);
  }

  private add(entry: ScreenViewEntry): void {
    this.log.update((log) => addScreenViewEntry(log, entry));
  }

  async send(c: ScreenViewCase): Promise<void> {
    this.add(await sendScreenView(this.acoustic.plugin, c));
  }

  async sendAll(): Promise<void> {
    await sendAllScreenViews(this.acoustic.plugin, (entry) => this.add(entry));
  }
}

/** The view of one case: the name it was opened with, a direct re-log of it, and the next case pushed on top. */
@Component({
  selector: 'app-screen-view-case',
  template: `
    <div class="view-header">
      <button class="action link" id="btn_case_back" (click)="acoustic.closeView('verification')">‹ Back</button>
      <h2 class="card-title">{{ shown() }}</h2>
    </div>

    <section class="card">
      <h2 class="card-title">Logged screen name</h2>
      <p class="card-text mono">{{ shown() }}</p>
      <p class="card-meta">{{ length() }} characters · the name of this view</p>
      @if (acoustic.caseLoad(); as line) {
        <p class="result-line" id="txt_case_load_result" [class.success]="line.ok" [class.error]="!line.ok">{{ line.text }}</p>
      }
    </section>

    <section class="card">
      <h2 class="card-title">Repeat</h2>
      <p class="card-text">Re-send the same name straight to the plugin, to compare the navigation-driven message against an explicit one.</p>
      <button class="action" id="btn_case_relog" [disabled]="!acoustic.sdkEnabled()" (click)="relog()">Log this name directly</button>
      @if (relogged(); as line) {
        <p class="result-line" id="txt_case_relog_result" [class.success]="line.ok" [class.error]="!line.ok">{{ line.text }}</p>
      }
      <button class="action secondary" id="btn_case_push_next" (click)="acoustic.enterCase(next().name ?? '')">Push deeper — {{ next().label }}</button>
    </section>
  `
})
export class BehaviourScreenViewCase {
  readonly acoustic = inject(AcousticService);
  readonly testCase = input.required<ScreenViewCase>();
  // Cleared when another case takes this view, as a pushed screen of its own would start empty
  readonly relogged = linkedSignal<ScreenViewCase, Line | null>({ source: this.testCase, computation: () => null });

  shown(): string {
    return describeName(this.testCase().name);
  }

  length(): number {
    return (this.testCase().name ?? '').length;
  }

  next(): ScreenViewCase {
    return nextCase(this.testCase().id);
  }

  async relog(): Promise<void> {
    const name = this.testCase().name ?? '';
    const outcome = await attempt(() => this.acoustic.screenLoad(name, 'Screen Views'));
    this.relogged.set({ ok: outcome.ok, text: reloggedLine(outcome) });
  }
}
