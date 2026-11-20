import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { scheduleEmailJob } from '../queues/emailQueue';
import { indexEmailInES, searchEmails } from '../services/searchService';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'reachinbox-super-secret-jwt-key';

function getUserId(req: Request): string | null {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
}

// 1. Schedule a single email OR bulk campaign (from CSV / recipient list)
router.post('/schedule', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const {
      senderId,
      campaignName,
      subject,
      body,
      recipients, // string[] of email addresses
      startTime, // ISO string or null (defaults to now)
      delayBetweenSeconds, // stagger between consecutive emails (e.g., 5s)
      hourlyLimit,
    } = req.body;

    if (!senderId || !subject || !body || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        error: 'senderId, subject, body, and at least one recipient email are required.',
      });
    }

    const sender = await prisma.sender.findFirst({
      where: { id: senderId, userId },
    });

    if (!sender) {
      return res.status(404).json({ error: 'Selected sender not found' });
    }

    // Deduplicate and clean recipient emails
    const cleanRecipients = Array.from(
      new Set(
        recipients
          .map((e: string) => String(e).trim().toLowerCase())
          .filter((e: string) => e.includes('@'))
      )
    );

    if (cleanRecipients.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses provided.' });
    }

    const baseStart = startTime ? new Date(startTime) : new Date();
    const gapMs = Math.max(1, Number(delayBetweenSeconds) || 2) * 1000;
    const effectiveHourlyLimit = Number(hourlyLimit) || sender.hourlyLimit || 20;

    // Create Campaign record
    // Create Campaign record
    const campaign = await prisma.campaign.create({
      data: {
        userId,
        senderId: sender.id,
        subject,
        body,
        startTime: baseStart,
        delayBetweenMs: gapMs,
        hourlyLimit: effectiveHourlyLimit,
      },
    });

    const createdJobs = [];

    for (let i = 0; i < cleanRecipients.length; i++) {
      const recipientEmail = cleanRecipients[i];
      const scheduledAt = new Date(baseStart.getTime() + i * gapMs);

      const emailJob = await prisma.emailJob.create({
        data: {
          userId,
          senderId: sender.id,
          campaignId: campaign.id,
          recipientEmail,
          subject,
          body,
          status: 'SCHEDULED',
          scheduledAt,
        },
      });

      await indexEmailInES({
        id: emailJob.id,
        userId: emailJob.userId,
        recipientEmail: emailJob.recipientEmail,
        subject: emailJob.subject,
        body: emailJob.body,
        status: emailJob.status,
        scheduledAt: emailJob.scheduledAt.toISOString(),
        sentAt: null,
      });

      await scheduleEmailJob(emailJob.id, scheduledAt);
      createdJobs.push(emailJob);
    }

    res.status(201).json({
      message: `Scheduled ${createdJobs.length} email(s) successfully.`,
      campaign,
      count: createdJobs.length,
    });
  } catch (err: any) {
    console.error('❌ Schedule email error:', err.message);
    res.status(500).json({ error: 'Failed to schedule emails' });
  }
});

// 2. List & search emails (uses Elasticsearch when query is provided)
router.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const q = (req.query.q as string) || '';
  const status = (req.query.status as string) || 'ALL';

  const emails = await searchEmails(userId, q, status);
  res.json(emails);
});

// 3. Dashboard summary counts
router.get('/stats', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const [total, scheduled, sent, failed] = await Promise.all([
    prisma.emailJob.count({ where: { userId } }),
    prisma.emailJob.count({ where: { userId, status: 'SCHEDULED' } }),
    prisma.emailJob.count({ where: { userId, status: 'SENT' } }),
    prisma.emailJob.count({ where: { userId, status: 'FAILED' } }),
  ]);

  res.json({ total, scheduled, sent, failed });
});

export default router;