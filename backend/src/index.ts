import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initElasticsearch } from './config/elasticsearch';
import { startEmailWorker, recoverPendingJobs } from './queues/emailQueue';
import authRoutes from './routes/authRoutes';
import senderRoutes from './routes/senderRoutes';
import emailRoutes from './routes/emailRoutes';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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
  await initElasticsearch();
  startEmailWorker();
  await recoverPendingJobs();

  app.listen(PORT, () => {
    console.log(`🚀 ReachInbox Backend running at http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});