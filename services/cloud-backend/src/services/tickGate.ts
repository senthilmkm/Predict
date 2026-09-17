let held = false;

export function tryAcquireTick(): boolean {
  if (held) return false;
  held = true;
  return true;
}

export function releaseTick(): void {
  held = false;
}

export function resetTickGateForTests(): void {
  held = false;
}

export function isTickHeld(): boolean {
  return held;
}
