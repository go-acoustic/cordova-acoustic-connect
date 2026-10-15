/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'applications', 'DemoCapacitor', 'src', 'index.html'),
  'utf8',
);

// The identifier name becomes the key of the audience of the identity signal. The SDK's own documentation and the RN plugin write it as
// `Email`, so the field of the demo suggests that, not a lower-case `email` that may not match what the server has.
describe('the Identity screen of DemoCapacitor', () => {
  const field = (id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';

  it('suggests Email as the identifier name, as the SDK documentation does', () => {
    expect(field('et_identifier_name')).toContain('placeholder="e.g. Email"');
  });

  it('still suggests an address as the value', () => {
    expect(field('et_identifier_value')).toContain('placeholder="e.g. user@example.com"');
  });
});

export {};
