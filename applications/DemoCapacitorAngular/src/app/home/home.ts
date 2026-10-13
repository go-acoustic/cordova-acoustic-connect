import { Component, OnInit, inject, signal } from '@angular/core';
import { AcousticService } from '../acoustic.service';
import { BehaviourTab } from '../tabs/behaviour-tab';
import { IdentityTab } from '../tabs/identity-tab';
import { NotificationTab } from '../tabs/notification-tab';

type Tab = 'notification' | 'identity' | 'behaviour';

const TAB_TITLES: Record<Tab, string> = { notification: 'Push', identity: 'Identity', behaviour: 'Behaviour' };

/**
 * The same screens as applications/DemoCapacitor and the Cordova Demo app: three tabs, Notification, Identity and Behaviour (Actions,
 * Showcase, Verification). The SDK is started by the plugin block of capacitor.config.json when the app launches; this page only waits for it.
 */
@Component({
  selector: 'app-home',
  imports: [NotificationTab, IdentityTab, BehaviourTab],
  templateUrl: './home.html'
})
export class HomePage implements OnInit {
  readonly acoustic = inject(AcousticService);
  readonly tab = signal<Tab>('notification');
  readonly titles = TAB_TITLES;

  ngOnInit(): void {
    this.acoustic.showVersionInfo();
    void this.acoustic.waitForSdk();
  }

  select(tab: Tab): void {
    this.tab.set(tab);
    this.acoustic.setCurrentScreenName(tab + '_screen').catch(() => undefined);
  }
}
