/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const ICON = path.join(__dirname, '..', 'android', 'src', 'main', 'res', 'drawable', 'ic_notification.xml');

// The plugin ships a default small icon for push notifications, so an app without its own `ic_notification` still gets a valid
// one (a launcher icon crashes at delivery, so it is never the fallback). An app's own drawable of the same name wins.
describe('the default push notification icon', () => {
  it('ships with the plugin as the drawable ic_notification', () => {
    expect(fs.existsSync(ICON)).toBe(true);
  });

  it('is a vector, which scales to every density', () => {
    expect(fs.readFileSync(ICON, 'utf8')).toMatch(/<vector\b/);
  });

  it('is only opaque white or transparent, as Android renders small icons in one colour', () => {
    const colours = [...fs.readFileSync(ICON, 'utf8').matchAll(/android:fillColor="([^"]+)"/g)].map(
      (m: RegExpMatchArray) => m[1].toUpperCase(),
    );
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) expect(colour).toBe('#FFFFFFFF');
  });
});

export {};
