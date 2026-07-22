/**
 * Upstash Redis client — OPTIONAL.
 * If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set in .env,
 * the app uses Redis for distributed caching + rate limiting (production-grade).
 * If not set, falls back to in-memory (current behavior, fine for single-instance dev).
 */

import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis: Redis | null = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

export const isRedisEnabled = redis !== null;

/**
 * Generic cache-get with Redis fallback to in-memory.
 * Usage: const data = await cacheGet('key', async () => fetchExpensiveData(), 300);
 */
const memoryCache = new Map<string, { data: unknown; expires: number }>();

export async function cacheGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  // Try Redis first
  if (redis) {
    try {
      const cached = await redis.get<T>(key);
      if (cached) return cached;
      const fresh = await fetcher();
      await redis.setex(key, ttlSeconds, JSON.stringify(fresh));
      return fresh;
    } catch (e) {
      console.warn('[redis] Falling back to memory:', e instanceof Error ? e.message : 'unknown');
    }
  }
  // Fallback: in-memory
  const memCached = memoryCache.get(key);
  if (memCached && memCached.expires > Date.now()) {
    return memCached.data as T;
  }
  const fresh = await fetcher();
  memoryCache.set(key, { data: fresh, expires: Date.now() + ttlSeconds * 1000 });
  return fresh;
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
