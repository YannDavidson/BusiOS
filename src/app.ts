import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import twilio from 'twilio';
import { config } from './config.js';
import type { Orchestrator } from './orchestrator.js';
import type { MarisolVoiceService } from './voice/marisol.js';
import type { CallStatus } from './voice/types.js';

export function createApp(orchestrator: Orchestrator, voice?: MarisolVoiceService) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.body.From', 'req.body.To'] }));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'busios-ai' }));
  app.post('/webhooks/twilio/whatsapp', express.urlencoded({ extended: false }), async (req, res) => {
    if (!validTwilioRequest(req)) { res.status(403).send('Invalid Twilio signature'); return; }
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
  const voiceParser = express.urlencoded({ extended: false });
  app.post('/webhooks/twilio/voice', voiceParser, async (req, res) => {
    if (!voice) { res.status(503).send('Voice is unavailable'); return; }
    if (!validTwilioRequest(req)) { res.status(403).send('Invalid Twilio signature'); return; }
    const callSid = String(req.body.CallSid ?? ''), from = String(req.body.From ?? ''), to = String(req.body.To ?? '');
    if (!callSid || !from || !to) { res.status(400).send('CallSid, From, and To are required'); return; }
    try {
      const { number, greeting } = await voice.answer(callSid, from, to);
      const response = new twilio.twiml.VoiceResponse();
      if (number.realtimeEnabled && config.PUBLIC_BASE_URL) {
        const connect = response.connect();
        const stream = connect.stream({ url: `${config.PUBLIC_BASE_URL.replace(/^http/, 'ws').replace(/\/$/, '')}/webhooks/twilio/voice/stream` });
        stream.parameter({ name: 'to', value: to });
        stream.parameter({ name: 'businessId', value: number.businessId });
      } else addGather(response, greeting, number.language);
      res.type('text/xml').send(response.toString());
    } catch (error) { req.log.error({ err: error }, 'voice answer failed'); const response = new twilio.twiml.VoiceResponse(); response.say('This number is not configured. Please try again later.'); response.hangup(); res.type('text/xml').send(response.toString()); }
  });
  app.post('/webhooks/twilio/voice/gather', voiceParser, async (req, res) => {
    if (!voice) { res.status(503).send('Voice is unavailable'); return; }
    if (!validTwilioRequest(req)) { res.status(403).send('Invalid Twilio signature'); return; }
    const callSid = String(req.body.CallSid ?? ''), speech = String(req.body.SpeechResult ?? req.body.Digits ?? '').trim();
    const response = new twilio.twiml.VoiceResponse();
    try {
      if (!callSid || !speech) { response.say('I did not hear a response. Please call again.'); response.hangup(); res.type('text/xml').send(response.toString()); return; }
      const result = await voice.turn(callSid, speech);
      if (result.kind === 'transfer') { response.say(result.text); response.dial({ answerOnBridge: true, timeout: 20 }, result.number); }
      else if (result.kind === 'hangup') { response.say(result.text); response.hangup(); }
      else addGather(response, result.text, 'en');
      res.type('text/xml').send(response.toString());
    } catch (error) { req.log.error({ err: error }, 'voice gather failed'); response.say('I am sorry, I cannot complete that request. Please call again later.'); response.hangup(); res.type('text/xml').send(response.toString()); }
  });
  app.post('/webhooks/twilio/voice/status', voiceParser, async (req, res) => {
    if (!voice) { res.status(503).send('Voice is unavailable'); return; }
    if (!validTwilioRequest(req)) { res.status(403).send('Invalid Twilio signature'); return; }
    try { await voice.status(String(req.body.CallSid ?? ''), String(req.body.CallStatus ?? '') as CallStatus); res.sendStatus(204); }
    catch (error) { req.log.error({ err: error }, 'voice status failed'); res.status(500).send('Unable to update call'); }
  });
  return app;
}

function validTwilioRequest(req: express.Request) {
  if (config.NODE_ENV === 'test') return true;
  const signature = req.header('x-twilio-signature') ?? '';
  const base = config.PUBLIC_BASE_URL ? config.PUBLIC_BASE_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
  return Boolean(config.TWILIO_AUTH_TOKEN && twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, `${base}${req.originalUrl}`, req.body));
}

function addGather(response: twilio.twiml.VoiceResponse, text: string, language: 'en' | 'es' | 'pt') {
  const languageCode = language === 'es' ? 'es-US' : language === 'pt' ? 'pt-BR' : 'en-US';
  const gather = response.gather({ input: ['speech', 'dtmf'], action: '/webhooks/twilio/voice/gather', method: 'POST', speechTimeout: 'auto', language: languageCode, timeout: 5 });
  gather.say({ language: languageCode }, text);
  response.say({ language: languageCode }, text);
  response.redirect({ method: 'POST' }, '/webhooks/twilio/voice/gather');
}
