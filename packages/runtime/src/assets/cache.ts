// Keyed asset cache. Simple wrapper around a Map so consumers don't have
// to deal with the get-or-load pattern themselves.

export class AssetCache<T> {
  private store = new Map<string, T>();
  private inFlight = new Map<string, Promise<T>>();

  /**
   * Get an asset, loading it if not cached. Concurrent calls for the same
   * key share a single in-flight Promise.
   */
  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.store.get(key);
    if (cached !== undefined) return cached;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        this.store.set(key, value);
        this.inFlight.delete(key);
        return value;
      })
      .catch((err) => {
        this.inFlight.delete(key);
        throw err;
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  get(key: string): T | undefined {
    return this.store.get(key);
  }

  /** Set a value synchronously (for assets that are generated, not loaded). */
  set(key: string, value: T): void {
    this.store.set(key, value);
  }

  delete(key: string): T | undefined {
    const v = this.store.get(key);
    this.store.delete(key);
    return v;
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.store.size;
  }

  entries(): IterableIterator<[string, T]> {
    return this.store.entries();
  }
}
