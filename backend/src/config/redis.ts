import dotenv from 'dotenv';

dotenv.config();

const IORedis = require('ioredis');

const redisUrl =
  process.env.REDIS_URL ||
  'rediss://default:gQAAAAAAAgvPAAIncDEzZWM1ZmyYjJlODQ0N2U1OGY4YzIwYjA5ODYwMGt0Nw@teaching-squid-134095.upstash.io:6379';

const isTls = redisUrl.startsWith('rediss://');

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 10000,
  family: 4,
  tls: isTls ? { rejectUnauthorized: false } : undefined,
});

export const redis = redisConnection;

export const bullmqRedisOptions = {
  connection: redisConnection,
};

redisConnection.on('connect', () => {
  console.log('✅ Connected to Redis');
});

redisConnection.on('error', (err: any) => {
  if (err?.code !== 'ECONNRESET') {
    console.error('❌ Redis error:', err?.message || err);
  }
});