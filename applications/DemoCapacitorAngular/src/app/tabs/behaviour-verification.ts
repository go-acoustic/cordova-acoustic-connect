import { Component, computed, inject, signal } from '@angular/core';
import { AcousticService } from '../acoustic.service';
import { Outcome, SCREEN_VIEWS_SCREEN, Scenario, runScenario, scenariosFor, viewFor } from '../behaviour-core';
import { CustomEventBody, IdentityDefaultsBody, SignalBody } from './behaviour-contract-bodies';
import { BehaviourScreenViewCase, BehaviourScreenViews } from './behaviour-screen-views';

/** Behaviour › Verification: one card per scenario, with what to do and what the collector must show. */
@Component({
  selector: 'app-behaviour-verification',
  imports: [BehaviourScreenViews, BehaviourScreenViewCase, CustomEventBody, SignalBody, IdentityDefaultsBody],
  template: `
    @if (view(); as v) {
      @if (v.kind === 'screen-views') {
        <app-screen-views />
      } @else if (v.kind === 'case') {
        <app-screen-view-case [testCase]="v.testCase" />
      }
    } @else {
    <p class="behaviour-body">Run a scenario, send the app to the background, then check the collector against the expected result.</p>
    @for (s of scenarios; track s.key) {
      <section class="card">
        <h2 class="card-title">{{ s.title }}</h2>
        <p class="card-meta">{{ s.key }} · {{ s.channel }} · {{ s.platform === 'both' ? 'iOS + Android' : s.platform }}</p>
        <p class="card-label">Do</p>
        <p class="card-text">{{ s.action }}</p>
        <p class="card-label">Expect</p>
        <p class="card-text">{{ s.expected }}</p>
        <button class="action" [disabled]="!acoustic.sdkEnabled()" (click)="run(s)">Run</button>
        @if (outcomes()[s.key]; as o) {
          <p class="result-line" [class.success]="o.ok" [class.error]="!o.ok">{{ o.ok ? 'Queued' : o.message }}</p>
        }
      </section>
    }

    <section class="card">
      <h2 class="card-title">Screen Views</h2>
      <p class="card-text">Direct and navigated screen views, with the referrers they log.</p>
      <button class="action secondary" id="btn_open_screen_views" (click)="acoustic.openView('verification', screenViews)">Open Screen Views</button>
    </section>

    <section class="card">
      <h2 class="card-title">Custom event</h2>
      <app-custom-event-body />
    </section>

    <section class="card">
      <h2 class="card-title">Log Signal</h2>
      <app-signal-body />
    </section>

    <section class="card">
      <h2 class="card-title">Identity defaults</h2>
      <app-identity-defaults-body />
    </section>
    }
  `
})
export class BehaviourVerification {
  readonly acoustic = inject(AcousticService);
  readonly scenarios: Scenario[] = scenariosFor(this.acoustic.platform === 'android' ? 'android' : 'ios');
  readonly outcomes = signal<Record<string, Outcome>>({});
  readonly screenViews = SCREEN_VIEWS_SCREEN;
  /** The view on top of the Verification stack (kept in the service, so it outlives this component), null on the list of cards. */
  readonly view = computed(() => {
    const stack = this.acoustic.views()['verification'] ?? [];
    return stack.length ? viewFor(stack[stack.length - 1]) : null;
  });

  async run(scenario: Scenario): Promise<void> {
    const outcome = await runScenario(scenario, this.acoustic.plugin);
    this.outcomes.update((o) => ({ ...o, [scenario.key]: outcome }));
  }
}
