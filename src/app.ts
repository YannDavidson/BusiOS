import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import twilio from 'twilio';
import { config } from './config.js';
import type { Orchestrator } from './orchestrator.js';

export function createApp(orchestrator: Orchestrator) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.body.From', 'req.body.To'] }));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'busios-ai' }));
  app.post('/webhooks/twilio/whatsapp', express.urlencoded({ extended: false }), async (req, res) => {
    if (config.NODE_ENV !== 'test') {
      const signature = req.header('x-twilio-signature') ?? '';
      const url = config.PUBLIC_BASE_URL
        ? `${config.PUBLIC_BASE_URL}/webhooks/twilio/whatsapp`
        : `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      if (!config.TWILIO_AUTH_TOKEN || !twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, url, req.body)) {
        res.status(403).send('Invalid Twilio signature'); return;
      }
    }
    const from = String(req.body.From ?? '');
    const body = String(req.body.Body ?? '');
    if (!from || !body) { res.status(400).send('From and Body are required'); return; }
    try {
      const reply = await orchestrator.handle(from, body);
      const response = new twilio.twiml.MessagingResponse();
      response.message(reply);
      res.type('text/xml').send(response.toString());
    } catch (error) {
      req.log.error({ err: error }, 'whatsapp webhook failed');
      res.status(500).send('Unable to process message');
    }
  });
  return app;
}
