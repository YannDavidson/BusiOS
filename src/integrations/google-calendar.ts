import { createHash, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, assertGoogleOAuthConfig } from '../config.js';
import { decryptCredentials, encryptCredentials } from '../actions/vault.js';
import type { ActionStore } from '../actions/store.js';

const provider = 'google_calendar';
const scope = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';

export interface OAuthState { stateHash: string; businessId: string; userId: string; verifierCiphertext: string; expiresAt: string; }
export interface GoogleOAuthStore {
  isBusinessAdmin(userId: string, businessId: string): Promise<boolean>;
  createState(value: OAuthState): Promise<void>;
  consumeState(stateHash: string): Promise<OAuthState | null>;
}

export class MemoryGoogleOAuthStore implements GoogleOAuthStore {
  memberships = new Set<string>(); states = new Map<string, OAuthState>();
  async isBusinessAdmin(userId: string, businessId: string) { return this.memberships.has(`${userId}:${businessId}`); }
  async createState(value: OAuthState) { this.states.set(value.stateHash, structuredClone(value)); }
  async consumeState(stateHash: string) { const value = this.states.get(stateHash); if (!value) return null; this.states.delete(stateHash); return Date.parse(value.expiresAt) > Date.now() ? structuredClone(value) : null; }
}

export class SupabaseGoogleOAuthStore implements GoogleOAuthStore {
  constructor(private client: SupabaseClient) {}
  async isBusinessAdmin(userId: string, businessId: string) { const { data, error } = await this.client.from('business_memberships').select('business_id').eq('business_id', businessId).eq('user_id', userId).in('role', ['owner', 'admin']).maybeSingle(); if (error) throw error; return Boolean(data); }
  async createState(value: OAuthState) { const { error } = await this.client.from('oauth_authorization_states').insert({ state_hash: value.stateHash, business_id: value.businessId, user_id: value.userId, verifier_ciphertext: value.verifierCiphertext, expires_at: value.expiresAt }); if (error) throw error; }
  async consumeState(stateHash: string) { const now = new Date().toISOString(); const { data, error } = await this.client.from('oauth_authorization_states').update({ consumed_at: now }).eq('state_hash', stateHash).is('consumed_at', null).gt('expires_at', now).select('*').maybeSingle(); if (error) throw error; return data ? { stateHash: data.state_hash, businessId: data.business_id, userId: data.user_id, verifierCiphertext: data.verifier_ciphertext, expiresAt: data.expires_at } : null; }
}

export interface GoogleOAuthHttp {
  exchange(code: string, verifier: string, redirectUri: string): Promise<{ refreshToken?: string; accessToken: string; email?: string }>;
  refresh(refreshToken: string): Promise<string>;
  calendars(accessToken: string): Promise<Array<{ id: string; summary: string; primary: boolean; accessRole: string }>>;
  revoke(refreshToken: string): Promise<void>;
}

export class GoogleOAuthApi implements GoogleOAuthHttp {
  async exchange(code: string, verifier: string, redirectUri: string) { assertGoogleOAuthConfig(); const body = new URLSearchParams({ code, code_verifier: verifier, client_id: config.GOOGLE_OAUTH_CLIENT_ID!, client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: 'authorization_code' }); const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }); if (!response.ok) throw new Error(`Google OAuth token exchange failed: ${response.status}`); const value = await response.json() as { refresh_token?: string; access_token?: string; id_token?: string }; if (!value.access_token) throw new Error('Google OAuth response missing access token'); return { refreshToken: value.refresh_token, accessToken: value.access_token }; }
  async refresh(refreshToken: string) { assertGoogleOAuthConfig(); const body = new URLSearchParams({ client_id: config.GOOGLE_OAUTH_CLIENT_ID!, client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: 'refresh_token' }); const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }); if (!response.ok) throw new Error(`Google token refresh failed: ${response.status}`); const value = await response.json() as { access_token?: string }; if (!value.access_token) throw new Error('Google token response missing access token'); return value.access_token; }
  async calendars(accessToken: string) { const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer', { headers: { authorization: `Bearer ${accessToken}` } }); if (!response.ok) throw new Error(`Google Calendar list failed: ${response.status}`); const value = await response.json() as { items?: Array<{ id: string; summary?: string; primary?: boolean; accessRole?: string }> }; return (value.items ?? []).map((item) => ({ id: item.id, summary: item.summary ?? item.id, primary: item.primary ?? false, accessRole: item.accessRole ?? 'writer' })); }
  async revoke(refreshToken: string) { const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }); if (!response.ok && response.status !== 400) throw new Error(`Google token revocation failed: ${response.status}`); }
}

export class GoogleCalendarOAuthService {
  constructor(private oauthStore: GoogleOAuthStore, private actionStore: ActionStore, private google: GoogleOAuthHttp = new GoogleOAuthApi()) {}
  async authorizeUser(accessToken: string, businessId: string) { if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase authentication is unavailable'); const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); const { data, error } = await client.auth.getUser(accessToken); if (error || !data.user) throw new Error('Invalid BusiOS session'); if (!await this.oauthStore.isBusinessAdmin(data.user.id, businessId)) throw new Error('Business owner or admin access required'); return data.user.id; }
  async connect(businessId: string, userId: string) { assertGoogleOAuthConfig(); const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url'); const challenge = createHash('sha256').update(verifier).digest('base64url'); await this.oauthStore.createState({ stateHash: hash(state), businessId, userId, verifierCiphertext: encryptCredentials({ verifier }), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }); const query = new URLSearchParams({ client_id: config.GOOGLE_OAUTH_CLIENT_ID!, redirect_uri: redirectUri(), response_type: 'code', scope, access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state, code_challenge: challenge, code_challenge_method: 'S256' }); return `https://accounts.google.com/o/oauth2/v2/auth?${query}`; }
  async callback(state: string, code: string) { if (!state || !code) throw new Error('OAuth state and authorization code are required'); const saved = await this.oauthStore.consumeState(hash(state)); if (!saved) throw new Error('OAuth state is invalid, expired, or already used'); const { verifier } = decryptCredentials<{ verifier: string }>(saved.verifierCiphertext); const tokens = await this.google.exchange(code, verifier, redirectUri()); if (!tokens.refreshToken) throw new Error('Google did not return a refresh token; reconnect and grant consent'); const calendars = await this.google.calendars(tokens.accessToken); const selected = calendars.find((calendar) => calendar.primary) ?? calendars[0]; if (!selected) throw new Error('No writable Google Calendar is available'); await this.actionStore.saveIntegration(saved.businessId, provider, { calendarId: selected.id, calendarSummary: selected.summary, connectedBy: saved.userId, connectedAt: new Date().toISOString() }, encryptCredentials({ refreshToken: tokens.refreshToken })); return { businessId: saved.businessId, selectedCalendar: selected, calendars }; }
  async status(businessId: string) { const integration = await this.actionStore.getIntegration(businessId, provider); return integration ? { connected: true, calendarId: integration.calendarId, calendarSummary: integration.calendarSummary, connectedAt: integration.connectedAt } : { connected: false }; }
  async selectCalendar(businessId: string, calendarId: string) { const integration = await this.actionStore.getIntegration(businessId, provider); if (!integration?.credentialsCiphertext) throw new Error('Google Calendar is not connected'); const credentials = String(integration.credentialsCiphertext); const { refreshToken } = decryptCredentials<{ refreshToken: string }>(credentials); const calendars = await this.google.calendars(await this.google.refresh(refreshToken)); const selected = calendars.find((calendar) => calendar.id === calendarId); if (!selected) throw new Error('Selected calendar is unavailable or not writable'); await this.actionStore.saveIntegration(businessId, provider, { calendarId: selected.id, calendarSummary: selected.summary, connectedBy: integration.connectedBy, connectedAt: integration.connectedAt }, credentials); return this.status(businessId); }
  async disconnect(businessId: string) { const integration = await this.actionStore.getIntegration(businessId, provider); if (!integration?.credentialsCiphertext) return { disconnected: true }; const { refreshToken } = decryptCredentials<{ refreshToken: string }>(String(integration.credentialsCiphertext)); await this.google.revoke(refreshToken); await this.actionStore.disableIntegration(businessId, provider); return { disconnected: true }; }
}

export function createGoogleOAuthStore() { if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseGoogleOAuthStore(createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })); if (config.NODE_ENV === 'production') throw new Error('Persistent OAuth store required'); return new MemoryGoogleOAuthStore(); }
function redirectUri() { if (!config.PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL is required'); return `${config.PUBLIC_BASE_URL.replace(/\/$/, '')}/integrations/google/calendar/callback`; }
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
