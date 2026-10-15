/**
 * Values for the `enable` button (Behaviour › Showcase › SDK) only. The SDK starts by itself from the `plugins.AcousticConnect` block of
 * capacitor.config.json (appKey + postMessageUrl); `enable` is for an app that starts it from code (`autoEnable: false`).
 * Put your own key and collector URL here to try it.
 */
export const DEMO_ENABLE = {
  appKey: 'YOUR_CONNECT_APP_KEY_HERE',
  postURL: 'https://collector.example.com/collector/collectorPost'
};
