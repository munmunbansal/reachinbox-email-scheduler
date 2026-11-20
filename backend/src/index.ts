import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initElasticsearch } from './config/elasticsearch';
import { startEmailWorker, recoverPendingJobs } from './queues/emailQueue';
import authRoutes from './routes/authRoutes';
import senderRoutes from './routes/senderRoutes';
import emailRoutes from './routes/emailRoutes';

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught exception (kept server alive):', err.message);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('⚠️ Unhandled rejection (kept server alive):', reason?.message || reason);
});

const app = express();
const PORT = Number(process.env.PORT) || 5000;

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:')) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/senders', senderRoutes);
app.use('/api/emails', emailRoutes);

async function bootstrap() {
  app.listen(PORT, () => {
    console.log(`🚀 ReachInbox Backend running at http://localhost:${PORT}`);
  });

  try {
    await initElasticsearch();
    startEmailWorker();
    await recoverPendingJobs();
  } catch (err: any) {
    console.error('⚠️ Background service warning:', err.message);
  }
}

bootstrap();