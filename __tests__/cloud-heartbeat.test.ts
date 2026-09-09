import { pickCloudHeartbeatIso } from '../src/runtime/AppRuntime';

describe('pickCloudHeartbeatIso', () => {
  test('prefers the newer of user lastTickAt and worker last_worker_tick_at', () => {
    expect(pickCloudHeartbeatIso(undefined, undefined)).toBeNull();
    expect(pickCloudHeartbeatIso('nope', '')).toBeNull();
    const older = '2026-09-09T16:00:00.000Z';
    const newer = '2026-09-09T17:42:46.986Z';
    expect(pickCloudHeartbeatIso(older, newer)).toBe(newer);
    expect(pickCloudHeartbeatIso(newer, older)).toBe(newer);
  });
});
