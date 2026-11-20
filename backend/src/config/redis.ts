import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const isTls = redisUrl.startsWith('rediss://');

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 10000,
  family:4,
  connectTimeout: 15000,
  ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  retryStrategy(times) {
    return Math.min(times * 500, 3000);
  },
});

redisConnection.on('connect', () => {
  console.log('✅ Connected to Redis');
});

redisConnection.on('error', (err) => {
  console.error('⚠️ Redis warning:', err.message);
});