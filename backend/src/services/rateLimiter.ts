import { redis } from '../config/redis';

/**
 * Checks if a sender can send an email in the current hour window.
 * Uses an atomic Redis INCR + EXPIRE counter keyed by senderId and YYYY-MM-DD-HH.
 */
export async function checkAndIncrementRateLimit(
  senderId: string,
  maxPerHour: number
): Promise<{ allowed: boolean; delayMs: number; currentCount: number }> {
  const now = new Date();
  const hourBucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String( now.getUTCDate() ).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`;

  const key = `rate_limit:${senderId}:${hourBucket}`;

  const currentCount = await redis.incr(key);

  if (currentCount === 1) {
    // Expire key after 3700 seconds (~1 hour + buffer)
    await redis.expire(key, 3700);
  }

  if (currentCount <= maxPerHour) {
    return { allowed: true, delayMs: 0, currentCount };
  }

  // Roll back the extra increment since this email won't be sent this hour
  await redis.decr(key);

  // Calculate milliseconds remaining until the start of the next UTC hour + 2s buffer
  const nextHour = new Date(now);
  nextHour.setUTCHours(now.getUTCHours() + 1, 0, 2, 0);
  const delayMs = Math.max(1000, nextHour.getTime() - now.getTime());

  return { allowed: false, delayMs, currentCount: maxPerHour };
}