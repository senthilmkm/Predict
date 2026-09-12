import { create } from 'zustand';
import { getKeyValueStore } from '../platform/storage';
import {
  normalizePinnedPathIds,
  PathFocusId,
  PINNED_PATHS_MAX,
} from '../content/pathCatalog';

const STORAGE_KEY = 'predict.pinned_paths.v1';

let hydrateInFlight: Promise<void> | null = null;

type PinnedPathsState = {
  ids: PathFocusId[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  toggle: (id: PathFocusId) => Promise<{ ok: true } | { ok: false; reason: 'max' }>;
};

async function persist(ids: PathFocusId[]): Promise<void> {
  await getKeyValueStore().setItem(STORAGE_KEY, JSON.stringify(ids));
}

export const usePinnedPathsStore = create<PinnedPathsState>((set, get) => ({
  ids: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    if (hydrateInFlight) return hydrateInFlight;
    hydrateInFlight = (async () => {
      try {
        const raw = await getKeyValueStore().getItem(STORAGE_KEY);
        const ids = raw ? normalizePinnedPathIds(JSON.parse(raw)) : [];
        set({ ids, hydrated: true });
      } catch {
        set({ ids: [], hydrated: true });
      } finally {
        hydrateInFlight = null;
      }
    })();
    return hydrateInFlight;
  },
  toggle: async (id) => {
    const cur = get().ids;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (next.length > PINNED_PATHS_MAX) return { ok: false, reason: 'max' };
    set({ ids: next, hydrated: true });
    try {
      await persist(next);
    } catch {
      set({ ids: cur });
      return { ok: false, reason: 'max' };
    }
    return { ok: true };
  },
}));

export function resetPinnedPathsStoreForTests(): void {
  hydrateInFlight = null;
  usePinnedPathsStore.setState({ ids: [], hydrated: false });
}
