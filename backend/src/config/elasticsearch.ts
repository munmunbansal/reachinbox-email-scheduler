import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';

dotenv.config();

export const esClient = process.env.ELASTICSEARCH_URL
  ? new Client({
      node: process.env.ELASTICSEARCH_URL,
      auth: {
        apiKey: process.env.ELASTICSEARCH_API_KEY || '',
      },
    })
  : null;

export const EMAIL_INDEX = 'reachinbox_emails';

export async function initElasticsearch() {
  if (!esClient) {
    console.log('⚠️ ELASTICSEARCH_URL not set, skipping ES init');
    return;
  }
  try {
    const exists = await esClient.indices.exists({ index: EMAIL_INDEX });
    if (!exists) {
      await esClient.indices.create({
        index: EMAIL_INDEX,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            userId: { type: 'keyword' },
            recipientEmail: { type: 'text' },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
          },
        },
      });
      console.log('✅ Created Elasticsearch index:', EMAIL_INDEX);
    } else {
      console.log('✅ Elasticsearch index ready:', EMAIL_INDEX);
    }
  } catch (err: any) {
    console.error('⚠️ Elasticsearch init warning:', err.message);
  }
}