import fs from 'fs';
import path from 'path';
import {
  getAppPublicConfig,
  supportContactEmail,
  supportContactLine,
  withSupportContact,
} from '../src/config/appMeta';

describe('config.json support contact', () => {
  test('root config.json exists and has support email', () => {
    const p = path.join(__dirname, '..', 'config.json');
    expect(fs.existsSync(p)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(raw.support_contact_email).toBe('senthil930@gmail.com');
  });

  test('appMeta loads email from config.json', () => {
    expect(supportContactEmail()).toBe('senthil930@gmail.com');
    expect(getAppPublicConfig().support_contact_label).toBe('Support');
    expect(supportContactLine()).toContain('senthil930@gmail.com');
  });

  test('withSupportContact appends email once', () => {
    const once = withSupportContact('Kalshi timeout');
    expect(once).toContain('Kalshi timeout');
    expect(once).toContain('senthil930@gmail.com');
    expect(withSupportContact(once)).toBe(once);
  });
});
