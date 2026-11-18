import { Component, OnInit, inject } from '@angular/core';
import { AcousticService } from '../acoustic.service';
import { BehaviourActions } from './behaviour-actions';
import { BehaviourShowcase } from './behaviour-showcase';
import { BehaviourVerification } from './behaviour-verification';

type Subtab = 'actions' | 'showcase' | 'verification';

/** The Behaviour tab: Actions (quick calls), Showcase (one card per feature) and Verification (scenarios with the expected result). */
@Component({
  selector: 'app-behaviour-tab',
  imports: [BehaviourActions, BehaviourShowcase, BehaviourVerification],
  template: `
    <div class="subtab-bar" role="tablist" aria-label="Behaviour sections">
      @for (s of subtabs; track s) {
        <button class="subtab-btn" [attr.id]="hubIds[s]" [class.active]="subtab() === s" role="tab" (click)="select(s)">{{ label(s) }}</button>
      }
    </div>
    @switch (subtab()) {
      @case ('actions') { <div class="subtab-content active"><app-behaviour-actions /></div> }
      @case ('showcase') { <div class="subtab-content active"><app-behaviour-showcase /></div> }
      @case ('verification') { <div class="subtab-content active"><app-behaviour-verification /></div> }
    }
  `
})
export class BehaviourTab implements OnInit {
  private readonly acoustic = inject(AcousticService);
  readonly subtabs: Subtab[] = ['actions', 'showcase', 'verification'];
  /** The hub's buttons of the sample UI contract: the Showcase and Verification sub-tab buttons. */
  readonly hubIds: Record<Subtab, string | null> = { actions: null, showcase: 'btn_open_showcase', verification: 'btn_open_verification' };
  /** Kept in the service: the sub-tab on display is the same when the tab is shown again. */
  readonly subtab = this.acoustic.subtab;

  label(s: Subtab): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  ngOnInit(): void {
    this.acoustic.screens.showTab('behaviour', this.subtab());
  }

  select(s: Subtab): void {
    this.subtab.set(s);
    this.acoustic.screens.showSubtab(s);
  }
}
