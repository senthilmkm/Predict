import { resetPinnedPathsStoreForTests, usePinnedPathsStore } from '../src/state/pinnedPathsStore';
import { isPinnedPathVisible } from '../src/content/pathCatalog';

describe('pinnedPathsStore prune', () => {
  beforeEach(() => {
    resetPinnedPathsStoreForTests();
  });

  test('pruning admin-off ghosts frees a pin slot', async () => {
    const store = usePinnedPathsStore.getState();
    usePinnedPathsStore.setState({
      ids: ['home', 'auto', 'cheapLoop'],
      hydrated: true,
    });
    const flags = { cheapLoopFeatureOn: false, bufferRunFeatureOn: true };
    await store.prune((id) => isPinnedPathVisible(id, flags));
    expect(usePinnedPathsStore.getState().ids).toEqual(['home', 'auto']);
    const pin = await usePinnedPathsStore.getState().toggle('bufferRun');
    expect(pin).toEqual({ ok: true });
    expect(usePinnedPathsStore.getState().ids).toEqual(['home', 'auto', 'bufferRun']);
  });
});
