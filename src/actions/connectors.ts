import twilio from 'twilio';
import { config } from '../config.js';
import { decryptCredentials } from './vault.js';
import type { ActionStore } from './store.js';
import type { ConnectorResult, VerifiedAction } from './types.js';

export interface ActionConnector { execute(action: VerifiedAction): Promise<ConnectorResult>; }

export class InternalCrmConnector implements ActionConnector {
  constructor(private store: ActionStore) {}
  async execute(action: VerifiedAction): Promise<ConnectorResult> { const key = requiredString(action.payload, 'externalKey'); const id = await this.store.upsertCrmContact(action.businessId, key, action.payload); return { provider: 'busios-crm', resourceId: id, status: 'verified', details: { operation: 'upsert' }, usage: [{ metric: 'crm_write', quantity: 1, estimatedCostMicros: 0 }] }; }
}

export class TwilioConfirmationConnector implements ActionConnector {
  private client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  async execute(action: VerifiedAction): Promise<ConnectorResult> { const channel = requiredString(action.payload, 'channel'); const prefix = channel === 'whatsapp' ? 'whatsapp:' : ''; const from = channel === 'whatsapp' ? config.TWILIO_WHATSAPP_NUMBER : requiredString(action.payload, 'from'); const message = await this.client.messages.create({ to: `${prefix}${requiredString(action.payload, 'to').replace(/^whatsapp:/, '')}`, from, body: requiredString(action.payload, 'body'), statusCallback: `${requiredBase()}/webhooks/twilio/actions/message-status` }); return { provider: 'twilio-message', resourceId: message.sid, status: 'accepted', details: { channel, initialStatus: message.status }, usage: [{ metric: channel === 'whatsapp' ? 'whatsapp_message' : 'sms_segment_estimate', quantity: 1, estimatedCostMicros: 0 }] }; }
}

export class TwilioCallbackConnector implements ActionConnector {
  private client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  async execute(action: VerifiedAction): Promise<ConnectorResult> { const call = await this.client.calls.create({ to: requiredString(action.payload, 'to'), from: requiredString(action.payload, 'from'), twiml: `<Response><Say>${escapeXml(requiredString(action.payload, 'approvedMessage'))}</Say></Response>`, statusCallback: `${requiredBase()}/webhooks/twilio/actions/call-status`, statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'], machineDetection: 'Enable' }); return { provider: 'twilio-call', resourceId: call.sid, status: 'accepted', details: { initialStatus: call.status }, usage: [{ metric: 'outbound_call_attempt', quantity: 1, estimatedCostMicros: 0 }] }; }
}

export class GoogleCalendarConnector implements ActionConnector {
  constructor(private store: ActionStore) {}
  async execute(action: VerifiedAction): Promise<ConnectorResult> {
    const integration = await this.store.getIntegration(action.businessId, 'google_calendar');
    if (!integration?.credentialsCiphertext) throw new Error('Google Calendar is not connected for this business');
    const credentials = decryptCredentials<{ refreshToken: string }>(String(integration.credentialsCiphertext));
    const accessToken = await refreshGoogleToken(credentials.refreshToken);
    const calendarId = encodeURIComponent(String(integration.calendarId ?? 'primary'));
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?sendUpdates=all`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(action.payload.event) });
    if (!response.ok) throw new Error(`Google Calendar rejected event: ${response.status}`);
    const event = await response.json() as { id: string; htmlLink?: string; status?: string };
    return { provider: 'google-calendar', resourceId: event.id, status: 'verified', details: { htmlLink: event.htmlLink, status: event.status }, usage: [{ metric: 'calendar_event_created', quantity: 1, estimatedCostMicros: 0 }] };
  }
}

async function refreshGoogleToken(refreshToken: string) { if (!config.GOOGLE_OAUTH_CLIENT_ID || !config.GOOGLE_OAUTH_CLIENT_SECRET) throw new Error('Google OAuth client is not configured'); const body = new URLSearchParams({ client_id: config.GOOGLE_OAUTH_CLIENT_ID, client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }); const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }); if (!response.ok) throw new Error(`Google token refresh failed: ${response.status}`); const data = await response.json() as { access_token?: string }; if (!data.access_token) throw new Error('Google token response missing access token'); return data.access_token; }
function requiredString(payload: Record<string, unknown>, key: string) { const value = payload[key]; if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${key}`); return value; }
function requiredBase() { if (!config.PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL is required'); return config.PUBLIC_BASE_URL.replace(/\/$/, ''); }
function escapeXml(value: string) { return value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char); }
