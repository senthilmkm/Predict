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

/** Per-ticker buy claims for the current 15m contract. Cap comes from risk config. */
export class WindowLockRegistry {
  private locks = new Map<string, string[]>();

  count(marketTicker: string): number {
    return (this.locks.get(marketTicker) || []).length;
  }

  tryClaim(marketTicker: string, clientOrderId: string, maxClaims = 1): boolean {
    if (!marketTicker) return false;
    const cap = Math.min(5, Math.max(1, Math.round(Number(maxClaims) || 1)));
    const list = this.locks.get(marketTicker) || [];
    if (list.length >= cap) return false;
    list.push(clientOrderId);
    this.locks.set(marketTicker, list);
    return true;
  }

  /** Rebuild claims from hydrated fills (survives app restart). */
  claimExisting(marketTicker: string, clientOrderId = 'hydrated'): void {
    if (!marketTicker) return;
    const list = this.locks.get(marketTicker) || [];
    if (list.includes(clientOrderId)) return;
    list.push(clientOrderId);
    this.locks.set(marketTicker, list);
  }

  release(marketTicker: string, clientOrderId?: string): void {
    const list = this.locks.get(marketTicker) || [];
    if (!list.length) return;
    if (clientOrderId) {
      const i = list.lastIndexOf(clientOrderId);
      if (i >= 0) list.splice(i, 1);
    } else {
      list.pop();
    }
    if (list.length) this.locks.set(marketTicker, list);
    else this.locks.delete(marketTicker);
  }

  isLocked(marketTicker: string): boolean {
    return this.count(marketTicker) > 0;
  }

  clear(): void {
    this.locks.clear();
  }
}
