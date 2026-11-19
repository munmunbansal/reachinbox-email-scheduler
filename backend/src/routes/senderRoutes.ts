import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { createEtherealSenderAccount } from '../config/mailer';

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

// Get all senders for logged-in user
router.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const senders = await prisma.sender.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });

  res.json(senders);
});

// Create a new auto-provisioned Ethereal sender
router.post('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { name, hourlyLimit } = req.body;
    const ethereal = await createEtherealSenderAccount();

    const sender = await prisma.sender.create({
      data: {
        userId,
        name: name || `Sender (${ethereal.email.split('@')[0]})`,
        email: ethereal.email,
        etherealUser: ethereal.etherealUser,
        etherealPass: ethereal.etherealPass,
        hourlyLimit: Number(hourlyLimit) || 20,
      },
    });

    res.status(201).json(sender);
  } catch (err: any) {
    console.error('❌ Error creating Ethereal sender:', err.message);
    res.status(500).json({ error: 'Failed to create Ethereal sender account' });
  }
});

export default router;