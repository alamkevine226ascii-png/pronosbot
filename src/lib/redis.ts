/**
 * Upstash Redis client — OPTIONAL.
 * If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set in .env,
 * the app uses Redis for distributed caching + rate limiting (production-grade).
 * If not set, falls back to in-memory (current behavior, fine for single-instance dev).
 *
 * === SERIALIZATION WARNING (BUG FIX) ===
 * `JSON.stringify()` on a JS `Map` returns "{}" (Maps are NOT JSON-serializable).
 * This used to silently destroy cached odds maps (API-Football / Football-Data)
 * when Redis was enabled: the cache would fill with {}, and subsequent lookups
 * returned empty/plain objects → every match skipped. We now serialize Maps
 * explicitly as arrays ([ [key, value], ... ]) and rebuild them on read.
 */

import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis: Redis | null = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

export const isRedisEnabled = redis !== null;

/**
 * Map-aware JSON serialization.
 * - Map → { "__map": true, "entries": [[k, v], ...] }
 * - anything else → the value itself (Upstash get auto-parses JSON anyway, so
 *   we pass already-serializable structures; primitives/objects go straight).
 */
function serializeValue(value: unknown): unknown {
  if (value instanceof Map) {
    return { __map: true, entries: Array.from(value.entries()) };
  }
  return value;
}

/**
 * Rehydrate a value read from Redis.
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
 * Generic cache-get with Redis fallback to in-memory.
 * Usage: const data = await cacheGet('key', async () => fetchExpensiveData(), 300);
 * Supports Map values (serialized as entries arrays).
 */
export async function cacheGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  // Try Redis first
  if (redis) {
    try {
      const cached = await redis.get<unknown>(key);
      if (cached !== null && cached !== undefined) {
        return deserializeValue<T>(cached as T);
      }
      const fresh = await fetcher();
      await redis.setex(key, ttlSeconds, JSON.stringify(serializeValue(fresh)));
      return fresh;
    } catch (e) {
      console.warn('[redis] Falling back to memory:', e instanceof Error ? e.message : 'unknown');
    }
  }
  // Fallback: in-memory (safe for single-instance dev / local).
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
 * Used to back the /api/matchs response cache with Redis when available.
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(serializeValue(value)), { ex: ttlSeconds });
      return;
    } catch (e) {
      console.warn('[redis] cacheSet failed, storing in memory:', e instanceof Error ? e.message : 'unknown');
    }
  }
  lruPrune();
  memoryCache.set(key, { data: value, expires: Date.now() + ttlSeconds * 1000 });
}

/** Missing-key helper: does the cluster know about a key? (for diagnostics) */
export async function cacheGetRaw(key: string): Promise<unknown | null> {
  if (redis) {
    try {
      const raw = await redis.get<unknown>(key);
      if (raw !== null && raw !== undefined) return deserializeValue(raw);
    } catch { /* fall through */ }
  }
  const memCached = memoryCache.get(key);
  if (memCached && memCached.expires > Date.now()) return memCached.data;
  return null;
}

/**
 * Rate limiter with Redis fallback to in-memory.
 * Returns true if request is allowed, false if rate limit exceeded.
 */
const memoryRateLimit = new Map<string, { count: number; resetTime: number }>();

export async function rateLimitCheck(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  // Redis rate limiting (atomic)
  if (redis) {
    try {
      const redisKey = `ratelimit:${key}`;
      const current = await redis.incr(redisKey);
      if (current === 1) {
        await redis.expire(redisKey, windowSeconds);
      }
      const ttl = await redis.ttl(redisKey);
      const resetAt = Date.now() + (ttl > 0 ? ttl : windowSeconds) * 1000;
      return {
        allowed: current <= maxRequests,
        remaining: Math.max(0, maxRequests - current),
        resetAt,
      };
    } catch (e) {
      console.warn('[redis] Rate limit fallback to memory:', e instanceof Error ? e.message : 'unknown');
    }
  }
  // Fallback: in-memory
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