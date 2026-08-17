import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { agentIds } from '../agents/types.js';

export type PortalRole = 'owner' | 'admin' | 'member';
export interface PortalBusiness { id: string; name: string; role: PortalRole; onboardingStatus: string; }
export interface PortalDashboard { business: PortalBusiness; calendar: { connected: boolean; calendarSummary?: string }; voice: Record<string, unknown> | null; agents: Record<string, unknown>; billing: Record<string, unknown>; usage: Array<Record<string, unknown>>; }

export interface PortalStore {
  userForToken(token: string): Promise<{ id: string; email?: string } | null>;
  requestMagicLink(email: string, redirectTo: string): Promise<void>;
  listBusinesses(userId: string): Promise<PortalBusiness[]>;
  createBusiness(userId: string, name: string): Promise<PortalBusiness>;
  role(userId: string, businessId: string): Promise<PortalRole | null>;
  dashboard(businessId: string, role: PortalRole): Promise<PortalDashboard>;
  saveVoice(businessId: string, value: Record<string, unknown>): Promise<void>;
  saveAgents(businessId: string, value: Record<string, unknown>): Promise<void>;
}

export class MemoryPortalStore implements PortalStore {
  users = new Map<string, { id: string; email?: string }>(); businesses = new Map<string, PortalBusiness>(); memberships = new Map<string, PortalRole>(); voice = new Map<string, Record<string, unknown>>(); agents = new Map<string, Record<string, unknown>>();
  async userForToken(token: string) { return this.users.get(token) ?? null; }
  async requestMagicLink() { return; }
  async listBusinesses(userId: string) { return [...this.businesses.values()].filter((business) => this.memberships.has(`${userId}:${business.id}`)).map((business) => ({ ...business, role: this.memberships.get(`${userId}:${business.id}`)! })); }
  async createBusiness(userId: string, name: string) { const business = { id: randomUUID(), name, role: 'owner' as const, onboardingStatus: 'started' }; this.businesses.set(business.id, business); this.memberships.set(`${userId}:${business.id}`, 'owner'); return business; }
  async role(userId: string, businessId: string) { return this.memberships.get(`${userId}:${businessId}`) ?? null; }
  async dashboard(businessId: string, role: PortalRole) { const business = this.businesses.get(businessId); if (!business) throw new Error('Business not found'); return { business: { ...business, role }, calendar: { connected: false }, voice: this.voice.get(businessId) ?? null, agents: this.agents.get(businessId) ?? {}, billing: { planCode: 'pilot', status: 'active' }, usage: [] }; }
  async saveVoice(businessId: string, value: Record<string, unknown>) { this.voice.set(businessId, structuredClone(value)); }
  async saveAgents(businessId: string, value: Record<string, unknown>) { this.agents.set(businessId, structuredClone(value)); }
}

export class SupabasePortalStore implements PortalStore {
  constructor(private client: SupabaseClient) {}
  async userForToken(token: string) { const { data, error } = await this.client.auth.getUser(token); return error || !data.user ? null : { id: data.user.id, email: data.user.email }; }
  async requestMagicLink(email: string, redirectTo: string) { const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } }); if (error) throw error; }
  async listBusinesses(userId: string) { const { data, error } = await this.client.from('business_memberships').select('role, businesses(id,name,onboarding_status)').eq('user_id', userId); if (error) throw error; return (data ?? []).flatMap((row: any) => { const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses; return business ? [{ id: business.id, name: business.name ?? 'My business', role: row.role, onboardingStatus: business.onboarding_status ?? 'started' }] : []; }); }
  async createBusiness(userId: string, name: string): Promise<PortalBusiness> { const { data, error } = await this.client.rpc('create_owned_business', { owner_user_id: userId, business_name: name }); if (error) throw error; return { id: String(data), name, role: 'owner', onboardingStatus: 'started' }; }
  async role(userId: string, businessId: string) { const { data, error } = await this.client.from('business_memberships').select('role').eq('user_id', userId).eq('business_id', businessId).maybeSingle(); if (error) throw error; return data?.role ?? null; }
  async dashboard(businessId: string, role: PortalRole) { const [business, integration, voice, agents, billing, usage] = await Promise.all([
    this.client.from('businesses').select('*').eq('id', businessId).single(), this.client.from('integration_connections').select('status,config').eq('business_id', businessId).eq('provider', 'google_calendar').maybeSingle(), this.client.from('voice_agent_settings').select('*').eq('business_id', businessId).maybeSingle(), this.client.from('agent_configurations').select('config').eq('business_id', businessId).maybeSingle(), this.client.from('billing_accounts').select('*').eq('business_id', businessId).maybeSingle(), this.client.from('business_usage_monthly').select('*').eq('business_id', businessId).order('month', { ascending: false }).limit(24)
  ]); for (const result of [business, integration, voice, agents, billing, usage]) if (result.error) throw result.error; return { business: { id: business.data.id, name: business.data.name ?? 'My business', role, onboardingStatus: business.data.onboarding_status ?? 'started' }, calendar: { connected: integration.data?.status === 'active', calendarSummary: integration.data?.config?.calendarSummary }, voice: voice.data, agents: agents.data?.config ?? {}, billing: billing.data ?? { planCode: 'pilot', status: 'active' }, usage: usage.data ?? [] }; }
  async saveVoice(businessId: string, value: Record<string, unknown>) { const { error } = await this.client.from('voice_agent_settings').upsert({ business_id: businessId, business_name: value.businessName, language: value.language, greeting: value.greeting, fallback_message: value.fallbackMessage, transfer_number: value.transferNumber || null, realtime_enabled: value.realtimeEnabled ?? false, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }); if (error) throw error; if (value.phoneNumber) { const phoneNumber = String(value.phoneNumber); const existing = await this.client.from('voice_numbers').select('business_id').eq('phone_number', phoneNumber).maybeSingle(); if (existing.error) throw existing.error; if (existing.data && existing.data.business_id !== businessId) throw new Error('Phone number is already assigned to another business'); const { error: numberError } = await this.client.from('voice_numbers').upsert({ business_id: businessId, phone_number: phoneNumber, active: true }, { onConflict: 'phone_number' }); if (numberError) throw numberError; } }
  async saveAgents(businessId: string, value: Record<string, unknown>) { const { error } = await this.client.from('agent_configurations').upsert({ business_id: businessId, config: value, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }); if (error) throw error; }
}

export class OwnerPortalService {
  constructor(private store: PortalStore) {}
  async requestMagicLink(email: string) { if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Valid email is required'); if (!config.PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL is required'); await this.store.requestMagicLink(email, `${config.PUBLIC_BASE_URL.replace(/\/$/, '')}/portal`); }
  async authenticate(token: string) { const user = await this.store.userForToken(token); if (!user) throw new Error('Invalid or expired BusiOS session'); return user; }
  async list(token: string) { const user = await this.authenticate(token); return this.store.listBusinesses(user.id); }
  async create(token: string, name: string) { const user = await this.authenticate(token); const clean = name.trim(); if (clean.length < 2 || clean.length > 120) throw new Error('Business name must be 2–120 characters'); return this.store.createBusiness(user.id, clean); }
  async dashboard(token: string, businessId: string) { const { user, role } = await this.authorize(token, businessId); void user; return this.store.dashboard(businessId, role); }
  async saveVoice(token: string, businessId: string, value: Record<string, unknown>) { await this.authorizeAdmin(token, businessId); const language = String(value.language ?? 'en'); if (!['en', 'es', 'pt'].includes(language)) throw new Error('Unsupported language'); if (!String(value.businessName ?? '').trim() || !String(value.greeting ?? '').trim() || !String(value.fallbackMessage ?? '').trim()) throw new Error('Business name, greeting, and fallback message are required'); for (const field of ['phoneNumber', 'transferNumber']) { const phone = String(value[field] ?? ''); if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error(`${field} must use E.164 format`); } await this.store.saveVoice(businessId, value); }
  async saveAgents(token: string, businessId: string, value: Record<string, unknown>) { await this.authorizeAdmin(token, businessId); const enabled = Array.isArray(value.enabled) ? value.enabled.map(String) : []; if (!enabled.includes('DIEGO') || enabled.some((id) => !agentIds.includes(id as typeof agentIds[number]))) throw new Error('Agent configuration must include Diego and only registered agents'); await this.store.saveAgents(businessId, { enabled: [...new Set(enabled)] }); }
  private async authorize(token: string, businessId: string) { const user = await this.authenticate(token); const role = await this.store.role(user.id, businessId); if (!role) throw new Error('Business access required'); return { user, role }; }
  private async authorizeAdmin(token: string, businessId: string) { const result = await this.authorize(token, businessId); if (!['owner', 'admin'].includes(result.role)) throw new Error('Business owner or admin access required'); return result; }
}

export function createOwnerPortalService() { if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) return new OwnerPortalService(new SupabasePortalStore(createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }))); if (config.NODE_ENV === 'production') throw new Error('Persistent portal store required'); return new OwnerPortalService(new MemoryPortalStore()); }
