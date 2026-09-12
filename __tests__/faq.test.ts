import { faqItemSearchText, flattenFaqItems, getFaqCategories } from '../src/content/faq';
import { supportContactEmail } from '../src/config/appMeta';

describe('FAQ content', () => {
  const categories = getFaqCategories();
  const items = flattenFaqItems(categories);

  test('covers the product in grouped, non-empty Q&A (not HTML)', () => {
    expect(categories.length).toBeGreaterThanOrEqual(8);
    expect(items.length).toBeGreaterThanOrEqual(35);
    for (const cat of categories) {
      expect(cat.id).toBeTruthy();
      expect(cat.title).toBeTruthy();
      expect(cat.items.length).toBeGreaterThan(0);
    }
    for (const item of items) {
      expect(item.id).toBeTruthy();
      expect(item.q.endsWith('?')).toBe(true);
      expect(item.a.length).toBeGreaterThan(40);
      expect(item.a).not.toMatch(/<\/?[a-z][\s\S]*?>/i);
      expect(item.q).not.toMatch(/<\/?[a-z][\s\S]*?>/i);
    }
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('includes disclaimer, cloud, window cap, and support facts', () => {
    const blob = items.map((i) => faqItemSearchText(i)).join('\n');
    expect(blob).toMatch(/does not guarantee profits/i);
    expect(blob).toMatch(/not affiliated/i);
    expect(blob).toMatch(/financial, investment, legal, or trading advice/i);
    expect(blob).toMatch(/Protect money/);
    expect(blob).toMatch(/Smart buy/);
    expect(blob).toMatch(/Cash out/);
    expect(blob).toMatch(/Cash out stop/);
    expect(blob).toMatch(/Skip thin bid/);
    expect(blob).toMatch(/If book size unknown/);
    expect(blob).toMatch(/Fail closed — no buy/);
    expect(blob).toMatch(/Does not skip or dump/);
    expect(categories.some((c) => c.id === 'skipthin')).toBe(true);
    expect(blob).toMatch(/Gold fade/);
    expect(blob).toMatch(/TWAP lock/);
    expect(blob).toMatch(/Last-minute/);
    expect(blob).toMatch(/Step buy/);
    expect(blob).toMatch(/Spike fade/);
    expect(blob).toMatch(/Pair lock/);
    expect(blob).toMatch(/This is not Gold fade/);
    expect(blob).toMatch(/Stop adding with 30s left/);
    expect(blob).toMatch(/does not pull coins off those paths/);
    expect(blob).toMatch(/clip ladder/);
    expect(blob).toMatch(/Watch start/);
    expect(blob).toMatch(/Sell if flip/);
    expect(blob).toMatch(/will not Cash out or Auto-lean that coin/);
    expect(blob).toMatch(/strike × 60/);
    expect(blob).toMatch(/cheaper ticket/);
    expect(blob).toMatch(/with you/);
    expect(blob).toMatch(/against you/);
    expect(blob).toMatch(/▲ live over strike/);
    expect(blob).toMatch(/▼ live under strike/);
    expect(blob).toMatch(/dollar distance between the live price and the strike/);
    expect(blob).toMatch(/Cloud Run/);
    expect(blob).toMatch(/phone never talks to Kalshi/i);
    expect(blob).toMatch(/Home Buy \/ Sell/);
    expect(blob).toMatch(/Shared \(one Kalshi account/);
    expect(blob).toMatch(/daily loss stop/i);
    expect(blob).toMatch(/Max trades \/ asset \/ 15m window/);
    expect(blob).toMatch(/\$29\.99/);
    expect(blob).toMatch(/7-day/);
    expect(blob).toMatch(/kill switch/i);
    expect(blob).toMatch(/settlements continue after Auto-trade Off/i);
    expect(blob).toMatch(/lean below your cushion is not stored/i);
    expect(blob).toMatch(/below cushion/i);
    expect(blob).toMatch(/next window/);
    expect(blob).toMatch(/Mute vs Notify on lean signals/i);
    expect(blob).toMatch(/silent log/i);
    expect(blob).toMatch(/400 most recent Cloud alerts/);
    expect(blob).toMatch(/Secure Store/);
    expect(blob).toContain(supportContactEmail());
    expect(categories.some((c) => c.id === 'disclaimer')).toBe(true);
  });
});
