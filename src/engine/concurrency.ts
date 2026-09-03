/** Single-flight mutex for order placement — no parallel POSTs. */
export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();
  private locked = false;

  get isLocked(): boolean {
    return this.locked;
  }

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.chain;
    this.chain = prev.then(() => gate);
    await prev;
    this.locked = true;
    try {
      return await fn();
    } finally {
      this.locked = false;
      release();
    }
  }
}

export class WindowLockRegistry {
  private locks = new Map<string, { claimedAt: number; clientOrderId: string }>();

  tryClaim(marketTicker: string, clientOrderId: string): boolean {
    if (!marketTicker) return false;
    if (this.locks.has(marketTicker)) return false;
    this.locks.set(marketTicker, { claimedAt: Date.now(), clientOrderId });
    return true;
  }

  release(marketTicker: string): void {
    this.locks.delete(marketTicker);
  }

  isLocked(marketTicker: string): boolean {
    return this.locks.has(marketTicker);
  }

  clear(): void {
    this.locks.clear();
  }
}
