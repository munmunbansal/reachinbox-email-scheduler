import axios from 'axios';
import { prisma } from '../config/db';

export async function sendSlackNotification(
  userId: string,
  message: string
): Promise<void> {
  try {
    const slackIntegration = await prisma.slackIntegration.findUnique({
      where: { userId },
    });

    if (!slackIntegration || !slackIntegration.webhookUrl) {
      return; // User hasn't connected Slack yet—skip silently
    }

    await axios.post(slackIntegration.webhookUrl, {
      text: message,
    });
  } catch (err: any) {
    console.error('⚠️ Failed to send Slack notification:', err.message);
  }
}