/**
 * In-memory cache + rate limiting (standalone, no Redis).
 * Used for caching API responses and rate limiting.
 */

export const redis = null;
export const isRedisEnabled = false;

/**
 * Map-aware JSON serialization.
 * - Map → { "__map": true, "entries": [[k, v], ...] }
 * - anything else → the value itself
 */
function serializeValue(value: unknown): unknown {
  if (value instanceof Map) {
    return { __map: true, entries: Array.from(value.entries()) };
  }
  return value;
}

/**
 * Rehydrate a value read from cache.
 * If it was serialized as a Map, rebuild a real Map from the entries.
 */
function deserializeValue<T>(raw: T): T {
  if (
    raw &&
    typeof raw === 'object' &&
    (raw as any).__map === true &&
    Array.isArray((raw as any).entries)
  ) {
    return new Map((raw as any).entries) as unknown as T;
  }
  return raw;
}

const memoryCache = new Map<string, { data: unknown; expires: number }>();
const MEMORY_CACHE_MAX = 100;

/** Enforce a real LRU eviction + hard cap on the in-memory cache.
 *  Map preserves insertion order, so re-touching an existing key must
 *  delete + re-insert it to move it to the end (BUG FIX: was FIFO).
 *  We also prune BEFORE inserting so concurrent writers never exceed the cap. */
function lruTouch(key: string): void {
  if (memoryCache.has(key)) {
    const val = memoryCache.get(key)!;
    memoryCache.delete(key);
    memoryCache.set(key, val);
  }
}

function lruPrune(): void {
  while (memoryCache.size >= MEMORY_CACHE_MAX) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
    else break;
  }
}

/**
 * Generic cache-get with in-memory fallback.
 * Usage: const data = await cacheGet('key', async () => fetchExpensiveData(), 300);
 * Supports Map values (serialized as entries arrays).
 */
export async function cacheGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  // In-memory cache
  const memCached = memoryCache.get(key);
  if (memCached && memCached.expires > Date.now()) {
    lruTouch(key); // keep hot entries at the back of insertion order (real LRU)
    return memCached.data as T;
  }
  const fresh = await fetcher();
  lruPrune(); // prune before set → never exceeds cap even under race
  memoryCache.set(key, { data: fresh, expires: Date.now() + ttlSeconds * 1000 });
  return fresh;
}

/**
 * Generic cache-set: write a value directly into the cache (no fetcher).
 * Used to back the /api/matchs response cache.
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  lruPrune();
  memoryCache.set(key, { data: value, expires: Date.now() + ttlSeconds * 1000 });
}

/** Missing-key helper: does the cache know about a key? (for diagnostics) */
export async function cacheGetRaw(key: string): Promise<unknown | null> {
  const memCached = memoryCache.get(key);
  if (memCached && memCached.expires > Date.now()) return memCached.data;
  return null;
}

/**
 * Rate limiter with in-memory.
 * Returns true if request is allowed, false if rate limit exceeded.
 */
const memoryRateLimit = new Map<string, { count: number; resetTime: number }>();

export async function rateLimitCheck(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  // In-memory rate limiting
  const now = Date.now();
  const entry = memoryRateLimit.get(key);
  if (!entry || now > entry.resetTime) {
    const resetAt = now + windowSeconds * 1000;
    memoryRateLimit.set(key, { count: 1, resetTime: resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }
  entry.count++;
  return {
    allowed: entry.count <= maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt: entry.resetTime,
  };
}