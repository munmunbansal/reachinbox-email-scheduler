import { Router, Request, Response } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { createEtherealSenderAccount } from '../config/mailer';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'reachinbox-super-secret-jwt-key';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

// 1. Redirect user to Google OAuth consent screen
router.get('/google', (_req: Request, res: Response) => {
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: `${BACKEND_URL}/api/auth/google/callback`,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
  };

  const qs = new URLSearchParams(options);
  res.redirect(`${rootUrl}?${qs.toString()}`);
});

// 2. Google OAuth Callback
router.get('/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    return res.redirect(`${FRONTEND_URL}?error=missing_code`);
  }

  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${BACKEND_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    });

    const { access_token } = tokenRes.data;

    const profileRes = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    const { id: googleId, email, name, picture } = profileRes.data;

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          avatarUrl: picture || null,
          googleId,
        },
      });

      const ethereal = await createEtherealSenderAccount();
      await prisma.sender.create({
        data: {
          userId: user.id,
          name: `${user.name} (Default Ethereal)`,
          email: ethereal.email,
          etherealUser: ethereal.etherealUser,
          etherealPass: ethereal.etherealPass,
          hourlyLimit: Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER) || 20,
        },
      });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: '7d',
    });

    res.redirect(`${FRONTEND_URL}?token=${token}`);
  } catch (err: any) {
    console.error('❌ Google OAuth error:', err.response?.data || err.message);
    res.redirect(`${FRONTEND_URL}?error=google_auth_failed`);
  }
});

// 3. Get Current Logged-in User Profile
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { slackIntegration: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      slackConnected: Boolean(user.slackIntegration?.webhookUrl),
      slackChannel: user.slackIntegration?.channelName || null,
    });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// 4. Redirect user to Slack OAuth to connect notifications
router.get('/slack', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId query parameter' });
  }

  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID || '',
    scope: 'incoming-webhook,chat:write',
    redirect_uri: `${BACKEND_URL}/api/auth/slack/callback`,
    state: userId,
  });

  res.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
});

// 5. Slack OAuth Callback
router.get('/slack/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const userId = req.query.state as string;

  if (!code || !userId) {
    return res.redirect(`${FRONTEND_URL}?slack=error`);
  }

  try {
    const params = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID || '',
      client_secret: process.env.SLACK_CLIENT_SECRET || '',
      code,
      redirect_uri: `${BACKEND_URL}/api/auth/slack/callback`,
    });

    const slackRes = await axios.post(
      'https://slack.com/api/oauth.v2.access',
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    if (!slackRes.data.ok) {
      console.error('❌ Slack OAuth response error:', slackRes.data);
      return res.redirect(`${FRONTEND_URL}?slack=error`);
    }

    const webhookUrl = slackRes.data.incoming_webhook?.url || '';
    const channelName = slackRes.data.incoming_webhook?.channel || '#general';
    const teamName = slackRes.data.team?.name || 'Slack Workspace';

    await prisma.slackIntegration.upsert({
      where: { userId },
      update: { webhookUrl, channelName, teamName },
      create: { userId, webhookUrl, channelName, teamName },
    });

    res.redirect(`${FRONTEND_URL}?slack=connected`);
  } catch (err: any) {
    console.error('❌ Slack callback error:', err.message);
    res.redirect(`${FRONTEND_URL}?slack=error`);
  }
});

// 6. Save Slack Incoming Webhook URL directly (for localhost testing)
router.post('/slack/webhook', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as { userId: string };
    const { webhookUrl, channelName } = req.body;

    if (!webhookUrl || !webhookUrl.startsWith('https://hooks.slack.com/')) {
      return res.status(400).json({ error: 'Please provide a valid Slack Webhook URL' });
    }

    await prisma.slackIntegration.upsert({
      where: { userId: decoded.userId },
      update: { webhookUrl, channelName: channelName || '#all-new-workspace', teamName: 'New Workspace' },
      create: { userId: decoded.userId, webhookUrl, channelName: channelName || '#all-new-workspace', teamName: 'New Workspace' },
    });

    res.json({ ok: true, channelName: channelName || '#all-new-workspace' });
  } catch (err: any) {
    console.error('❌ Slack webhook save error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to save Slack webhook' });
  }
});

export default router;