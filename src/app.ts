import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import twilio from 'twilio';
import { config } from './config.js';
import type { Orchestrator } from './orchestrator.js';
import type { MarisolVoiceService } from './voice/marisol.js';
import type { CallStatus } from './voice/types.js';
import type { VerifiedActionService } from './actions/service.js';
import type { GoogleCalendarOAuthService } from './integrations/google-calendar.js';
import type { OwnerPortalService } from './portal/service.js';

export function createApp(orchestrator: Orchestrator, voice?: MarisolVoiceService, actions?: VerifiedActionService, googleCalendar?: GoogleCalendarOAuthService, portal?: OwnerPortalService) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.body.From', 'req.body.To'] }));
  if (config.PORTAL_ENABLED) app.use('/portal', express.static('public', { index: 'index.html', fallthrough: false }));
  app.get('/', (_req, res) => res.redirect('/portal'));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'busios-ai' }));
  const json = express.json({ limit: '16kb' });
  app.post('/api/portal/auth/magic-link', json, async (req, res) => {
    if (!portal) { res.status(503).json({ error: 'Owner portal unavailable' }); return; }
    try { await portal.requestMagicLink(String(req.body?.email ?? '')); res.status(202).json({ sent: true }); } catch (error) { portalError(res, error); }
  });
  app.get('/api/portal/businesses', async (req, res) => {
    if (!portal) { res.status(503).json({ error: 'Owner portal unavailable' }); return; }
    try { res.json({ businesses: await portal.list(bearer(req)) }); } catch (error) { portalError(res, error); }
  });
  app.post('/api/portal/businesses', json, async (req, res) => {
    if (!portal) { res.status(503).json({ error: 'Owner portal unavailable' }); return; }
    try { res.status(201).json(await portal.create(bearer(req), String(req.body?.name ?? ''))); } catch (error) { portalError(res, error); }
  });
  app.get('/api/portal/businesses/:businessId/dashboard', async (req, res) => {
    if (!portal) { res.status(503).json({ error: 'Owner portal unavailable' }); return; }
    try { res.json(await portal.dashboard(bearer(req), req.params.businessId)); } catch (error) { portalError(res, error); }
  });
  app.put('/api/portal/businesses/:businessId/voice', json, async (req, res) => {
    if (!portal) { res.status(503).json({ error: 'Owner portal unavailable' }); return; }
    try { await portal.saveVoice(bearer(req), req.params.businessId, req.body ?? {}); res.json({ saved: true }); } catch (error) { portalError(res, error); }
  });
  app.put('/api/portal/businesses/:businessId/agents', json, async (req, res) => {
    if (!portal) { res.status(503).json({ error: 'Owner portal unavailable' }); return; }
    try { await portal.saveAgents(bearer(req), req.params.businessId, req.body ?? {}); res.json({ saved: true }); } catch (error) { portalError(res, error); }
  });
  app.get('/integrations/google/calendar/connect', async (req, res) => {
    if (!googleCalendar) { res.status(503).json({ error: 'Google Calendar integration unavailable' }); return; }
    try { const businessId = requiredBusinessId(req); const userId = await googleCalendar.authorizeUser(bearer(req), businessId); res.json({ authorizationUrl: await googleCalendar.connect(businessId, userId), expiresInSeconds: 600 }); }
    catch (error) { integrationError(res, error); }
  });
  app.get('/integrations/google/calendar/callback', async (req, res) => {
    if (!googleCalendar) { res.status(503).send('Google Calendar integration unavailable'); return; }
    if (req.query.error) { res.status(400).send('Google Calendar authorization was not granted. You may close this window.'); return; }
    try { const result = await googleCalendar.callback(String(req.query.state ?? ''), String(req.query.code ?? '')); res.status(200).type('html').send(`<!doctype html><title>BusiOS Calendar connected</title><main><h1>Google Calendar connected</h1><p>${escapeHtml(result.selectedCalendar.summary)} is ready for BusiOS. You may close this window.</p></main>`); }
    catch (error) { req.log.error({ err: error }, 'google oauth callback failed'); res.status(400).send('Google Calendar connection failed or expired. Start the connection again.'); }
  });
  app.get('/integrations/google/calendar/status', async (req, res) => {
    if (!googleCalendar) { res.status(503).json({ error: 'Google Calendar integration unavailable' }); return; }
    try { const businessId = requiredBusinessId(req); await googleCalendar.authorizeUser(bearer(req), businessId); res.json(await googleCalendar.status(businessId)); }
    catch (error) { integrationError(res, error); }
  });
  app.post('/integrations/google/calendar/select', json, async (req, res) => {
    if (!googleCalendar) { res.status(503).json({ error: 'Google Calendar integration unavailable' }); return; }
    try { const businessId = requiredBusinessId(req); await googleCalendar.authorizeUser(bearer(req), businessId); const calendarId = String(req.body?.calendarId ?? '').trim(); if (!calendarId) { res.status(400).json({ error: 'calendarId is required' }); return; } res.json(await googleCalendar.selectCalendar(businessId, calendarId)); }
    catch (error) { integrationError(res, error); }
  });
  app.delete('/integrations/google/calendar', async (req, res) => {
    if (!googleCalendar) { res.status(503).json({ error: 'Google Calendar integration unavailable' }); return; }
    try { const businessId = requiredBusinessId(req); await googleCalendar.authorizeUser(bearer(req), businessId); res.json(await googleCalendar.disconnect(businessId)); }
    catch (error) { integrationError(res, error); }
  });
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
  app.post('/webhooks/twilio/actions/message-status', voiceParser, async (req, res) => {
    if (!actions) { res.status(503).send('Actions unavailable'); return; }
    if (!validTwilioRequest(req)) { res.status(403).send('Invalid Twilio signature'); return; }
    try { await actions.providerStatus(String(req.body.MessageSid ?? ''), String(req.body.MessageStatus ?? ''), { errorCode: req.body.ErrorCode || null, segments: Number(req.body.NumSegments ?? 0) }); res.sendStatus(204); }
    catch (error) { req.log.error({ err: error }, 'message receipt failed'); res.status(500).send('Unable to update receipt'); }
  });
  app.post('/webhooks/twilio/actions/call-status', voiceParser, async (req, res) => {
    if (!actions) { res.status(503).send('Actions unavailable'); return; }
    if (!validTwilioRequest(req)) { res.status(403).send('Invalid Twilio signature'); return; }
    try { await actions.providerStatus(String(req.body.CallSid ?? ''), String(req.body.CallStatus ?? ''), { answeredBy: req.body.AnsweredBy || null, durationSeconds: Number(req.body.CallDuration ?? 0) }); res.sendStatus(204); }
    catch (error) { req.log.error({ err: error }, 'call receipt failed'); res.status(500).send('Unable to update receipt'); }
  });
  return app;
}

function bearer(req: express.Request) { const value = req.header('authorization') ?? ''; if (!value.startsWith('Bearer ') || value.length < 20) throw new Error('BusiOS authentication required'); return value.slice(7); }
function requiredBusinessId(req: express.Request) { const value = String(req.query.businessId ?? req.header('x-busios-business-id') ?? '').trim(); if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error('Valid businessId is required'); return value; }
function integrationError(res: express.Response, error: unknown) { const message = error instanceof Error ? error.message : 'Integration request failed'; const forbidden = /authentication|required|access/i.test(message); res.status(forbidden ? 403 : 400).json({ error: message }); }
function portalError(res: express.Response, error: unknown) { const message = error instanceof Error ? error.message : 'Portal request failed'; const forbidden = /session|access|required/i.test(message); res.status(forbidden ? 403 : 400).json({ error: message }); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char); }

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
