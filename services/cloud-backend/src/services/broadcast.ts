export interface BroadcastTemplate {
  id: string;
  title: string;
  message: string;
  show: boolean;
  /** ISO-8601. Null/empty = no end time. */
  showUntil: string | null;
}

export interface BroadcastConfig {
  templates: BroadcastTemplate[];
}

export const DEFAULT_MAINTENANCE_MESSAGE =
  'Predict is undergoing brief maintenance. Auto-trade and new orders may pause. Open positions stay on Kalshi until they settle or you exit.';

export function defaultBroadcastTemplates(): BroadcastTemplate[] {
  return [
    {
      id: 'system_maintenance',
      title: 'System maintenance',
      message: DEFAULT_MAINTENANCE_MESSAGE,
      show: false,
      showUntil: null,
    },
  ];
}

function parseUntil(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

export function normalizeBroadcastTemplate(
  raw?: Partial<BroadcastTemplate> | null,
  fallbackId = 'system_maintenance'
): BroadcastTemplate {
  const defaults = defaultBroadcastTemplates()[0];
  const id = String(raw?.id || fallbackId)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64) || fallbackId;
  const title = String(raw?.title || defaults.title).trim().slice(0, 80) || defaults.title;
  const message = String(raw?.message || defaults.message).trim().slice(0, 500) || defaults.message;
  return {
    id,
    title,
    message,
    show: raw?.show === true,
    showUntil: parseUntil(raw?.showUntil),
  };
}

export function normalizeBroadcastConfig(raw?: Partial<BroadcastConfig> | null): BroadcastConfig {
  const incoming = Array.isArray(raw?.templates) ? raw!.templates : [];
  const byId = new Map<string, BroadcastTemplate>();
  for (const t of defaultBroadcastTemplates()) {
    byId.set(t.id, t);
  }
  for (const row of incoming) {
    const next = normalizeBroadcastTemplate(row);
    byId.set(next.id, next);
  }
  if (!byId.has('system_maintenance')) {
    byId.set('system_maintenance', defaultBroadcastTemplates()[0]);
  }
  return { templates: [...byId.values()] };
}

export function mergeBroadcastConfig(
  existing: BroadcastConfig | undefined,
  patch: Partial<BroadcastConfig> | undefined
): BroadcastConfig {
  const base = normalizeBroadcastConfig(existing);
  if (!patch) return base;
  if (!Array.isArray(patch.templates)) return base;
  const byId = new Map(base.templates.map((t) => [t.id, t]));
  for (const row of patch.templates) {
    const prev = byId.get(String(row?.id || ''));
    const next = normalizeBroadcastTemplate({ ...prev, ...row }, prev?.id);
    byId.set(next.id, next);
  }
  return { templates: [...byId.values()] };
}

export function resolveActiveBroadcast(
  config: BroadcastConfig | undefined,
  nowMs = Date.now()
): { id: string; title: string; message: string } | null {
  const templates = normalizeBroadcastConfig(config).templates;
  for (const t of templates) {
    if (!t.show) continue;
    if (t.showUntil) {
      const until = Date.parse(t.showUntil);
      if (Number.isFinite(until) && nowMs >= until) continue;
    }
    const message = String(t.message || '').trim();
    if (!message) continue;
    return { id: t.id, title: t.title, message };
  }
  return null;
}
