import { esClient, EMAIL_INDEX } from '../config/elasticsearch';
import { prisma } from '../config/db';

export interface EmailSearchDoc {
  id: string;
  userId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
}

export async function indexEmailInES(doc: EmailSearchDoc): Promise<void> {
  if (!esClient) return;
  try {
    await esClient.index({
      index: EMAIL_INDEX,
      id: doc.id,
      document: doc,
      refresh: true,
    });
  } catch (err: any) {
    console.error('⚠️ Elasticsearch index error:', err.message);
  }
}

export async function searchEmails(
  userId: string,
  query: string,
  status?: string
) {
  // Try Elasticsearch first if configured and query is non-empty
  if (esClient && query.trim().length > 0) {
    try {
      const mustClauses: any[] = [
        { term: { userId } },
        {
          multi_match: {
            query: query.trim(),
            fields: ['subject^2', 'recipientEmail^2', 'body'],
            fuzziness: 'AUTO',
          },
        },
      ];

      if (status && status !== 'ALL') {
        mustClauses.push({ term: { status } });
      }

      const result = await esClient.search({
        index: EMAIL_INDEX,
        query: {
          bool: {
            must: mustClauses,
          },
        },
        size: 100,
      });

      const ids = result.hits.hits.map((hit: any) => hit._id);
      if (ids.length === 0) return [];

      return await prisma.emailJob.findMany({
        where: { id: { in: ids }, userId },
        include: { sender: true, campaign: true },
        orderBy: { scheduledAt: 'desc' },
      });
    } catch (err: any) {
      console.error('⚠️ ES search failed, falling back to Postgres:', err.message);
    }
  }

  // Fallback / default listing via Prisma
  return await prisma.emailJob.findMany({
    where: {
      userId,
      ...(status && status !== 'ALL' ? { status } : {}),
      ...(query.trim().length > 0
        ? {
            OR: [
              { subject: { contains: query.trim(), mode: 'insensitive' } },
              { recipientEmail: { contains: query.trim(), mode: 'insensitive' } },
              { body: { contains: query.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: { sender: true, campaign: true },
    orderBy: { scheduledAt: 'desc' },
    take: 100,
  });
}