import { getKeyValueStore } from '../platform/storage';
import { PortfolioSample, prunePortfolioSamples } from '../services/portfolioChange';

const PORTFOLIO_KEY = 'foresight.portfolio.samples.v1';

export async function loadPortfolioSamples(): Promise<PortfolioSample[]> {
  const kv = getKeyValueStore();
  try {
    const raw = await kv.getItem(PORTFOLIO_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw) as PortfolioSample[];
    if (!Array.isArray(rows)) return [];
    return prunePortfolioSamples(rows);
  } catch {
    return [];
  }
}

export async function persistPortfolioSamples(samples: PortfolioSample[]): Promise<void> {
  const kv = getKeyValueStore();
  await kv.setItem(PORTFOLIO_KEY, JSON.stringify(prunePortfolioSamples(samples)));
}
