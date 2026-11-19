import { Queue, Worker, Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/db';
import { getTransporter } from '../config/mailer';
import { checkAndIncrementRateLimit } from '../services/rateLimiter';
import { sendSlackNotification } from '../services/slackService';
import { indexEmailInES } from '../services/searchService';

export const EMAIL_QUEUE_NAME = 'reachinbox-email-queue';

export interface EmailJobPayload {
  emailJobId: string;
}

// 1. BullMQ Queue (persisted in Redis)
export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});

// Helper to enqueue a single email job with a target timestamp
export async function scheduleEmailJob(emailJobId: string, scheduledAt: Date) {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  await emailQueue.add(
    'send-email',
    { emailJobId },
    {
      jobId: emailJobId,
      delay,
    }
  );
}

// 2. BullMQ Worker
export function startEmailWorker() {
  const concurrency = Number(process.env.WORKER_CONCURRENCY) || 5;

  const worker = new Worker<EmailJobPayload>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobPayload>) => {
      const { emailJobId } = job.data;

      const emailRecord = await prisma.emailJob.findUnique({
        where: { id: emailJobId },
        include: {
          sender: true,
          campaign: true,
        },
      });

      if (!emailRecord) {
        console.warn(`⚠️ EmailJob ${emailJobId} not found in DB, skipping.`);
        return;
      }

      if (emailRecord.status === 'SENT') {
        return;
      }

      const ownerUserId = emailRecord.userId || emailRecord.campaign.userId;

      const maxPerHour =
        emailRecord.campaign?.hourlyLimit ||
        emailRecord.sender.hourlyLimit ||
        Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER) ||
        20;

      const rateCheck = await checkAndIncrementRateLimit(
        emailRecord.senderId,
        maxPerHour
      );

      if (!rateCheck.allowed) {
        const rescheduledTime = new Date(Date.now() + rateCheck.delayMs);
        console.log(
          `⏳ Rate limit hit for sender ${emailRecord.sender.email}. Rescheduling ${emailJobId} to ${rescheduledTime.toISOString()}`
        );

        await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'SCHEDULED',
            scheduledAt: rescheduledTime,
          },
        });

        await job.moveToDelayed(rescheduledTime.getTime(), job.token);
        return;
      }

      try {
        const transporter = getTransporter(
          emailRecord.sender.etherealUser,
          emailRecord.sender.etherealPass
        );

        const info = await transporter.sendMail({
          from: `"${emailRecord.sender.name || emailRecord.sender.email}" <${emailRecord.sender.email}>`,
          to: emailRecord.recipientEmail,
          subject: emailRecord.subject,
          text: emailRecord.body,
          html: `<div style="font-family: sans-serif; line-height: 1.6;">${emailRecord.body.replace(
            /\n/g,
            '<br/>'
          )}</div>`,
        });

        const previewUrl = nodemailer.getTestMessageUrl(info) || null;
        const sentAt = new Date();

        const updated = await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'SENT',
            sentAt,
            previewUrl,
            errorMessage: null,
          },
        });

        await indexEmailInES({
          id: updated.id,
          userId: ownerUserId,
          recipientEmail: updated.recipientEmail,
          subject: updated.subject,
          body: updated.body,
          status: updated.status,
          scheduledAt: updated.scheduledAt.toISOString(),
          sentAt: sentAt.toISOString(),
        });

        await sendSlackNotification(
          ownerUserId,
          `✅ *Email Sent* to \`${updated.recipientEmail}\`\n*Subject:* ${updated.subject}${
            previewUrl ? `\n*Preview:* ${previewUrl}` : ''
          }`
        );

        console.log(
          `📨 Sent email ${emailJobId} -> ${updated.recipientEmail} (${previewUrl || 'no preview'})`
        );
      } catch (err: any) {
        console.error(`❌ Failed sending email ${emailJobId}:`, err.message);

        const updated = await prisma.emailJob.update({
          where: { id: emailJobId },
          data: {
            status: 'FAILED',
            errorMessage: err.message || 'SMTP send error',
          },
        });

        await indexEmailInES({
          id: updated.id,
          userId: ownerUserId,
          recipientEmail: updated.recipientEmail,
          subject: updated.subject,
          body: updated.body,
          status: updated.status,
          scheduledAt: updated.scheduledAt.toISOString(),
          sentAt: null,
        });

        await sendSlackNotification(
          ownerUserId,
          `❌ *Email Failed* to \`${updated.recipientEmail}\`\n*Subject:* ${updated.subject}\n*Error:* ${err.message}`
        );

        throw err;
      }
    },
    {
      connection: redisConnection as any,
      concurrency,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`⚠️ BullMQ job ${job?.id} failed:`, err.message);
  });

  console.log(`🚀 BullMQ Email Worker started (concurrency: ${concurrency})`);
  return worker;
}

// 3. Recovery helper on server startup: re-enqueue any pending SCHEDULED jobs from DB
export async function recoverPendingJobs() {
  const pendingJobs = await prisma.emailJob.findMany({
    where: { status: 'SCHEDULED' },
  });

  for (const job of pendingJobs) {
    await scheduleEmailJob(job.id, job.scheduledAt);
  }

  if (pendingJobs.length > 0) {
    console.log(`🔄 Recovered ${pendingJobs.length} pending scheduled jobs from DB`);
  }
}