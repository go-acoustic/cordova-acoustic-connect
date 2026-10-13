import { Component, inject, signal } from '@angular/core';
import { AcousticService } from '../acoustic.service';
import { Outcome, Scenario, runScenario, scenariosFor } from '../behaviour-core';

/** Behaviour › Verification: one card per scenario, with what to do and what the collector must show. */
@Component({
  selector: 'app-behaviour-verification',
  template: `
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
  `
})
export class BehaviourVerification {
  readonly acoustic = inject(AcousticService);
  readonly scenarios: Scenario[] = scenariosFor(this.acoustic.platform === 'android' ? 'android' : 'ios');
  readonly outcomes = signal<Record<string, Outcome>>({});

  async run(scenario: Scenario): Promise<void> {
    const outcome = await runScenario(scenario, this.acoustic.plugin);
    this.outcomes.update((o) => ({ ...o, [scenario.key]: outcome }));
  }
}
