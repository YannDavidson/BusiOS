import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { CallSession, CallStatus, CallSummary, VoiceAction, VoiceNumber } from './types.js';

export interface VoiceStore {
  findNumber(phoneNumber: string): Promise<VoiceNumber | null>;
  createSession(session: CallSession): Promise<void>;
  getSession(callSid: string): Promise<CallSession | null>;
  addTurn(callSid: string, role: 'caller' | 'marisol', text: string): Promise<void>;
  addAction(action: VoiceAction): Promise<void>;
  updateStatus(callSid: string, status: CallStatus): Promise<void>;
  saveSummary(callSid: string, businessId: string, summary: CallSummary): Promise<void>;
}

export class MemoryVoiceStore implements VoiceStore {
  numbers = new Map<string, VoiceNumber>(); sessions = new Map<string, CallSession>(); actions: VoiceAction[] = []; summaries = new Map<string, CallSummary>();
  async findNumber(phoneNumber: string) { return structuredClone(this.numbers.get(phoneNumber) ?? null); }
  async createSession(session: CallSession) { this.sessions.set(session.callSid, structuredClone(session)); }
  async getSession(callSid: string) { return structuredClone(this.sessions.get(callSid) ?? null); }
  async addTurn(callSid: string, role: 'caller' | 'marisol', text: string) { const session = this.sessions.get(callSid); if (!session) throw new Error('Call session not found'); session.turns.push({ role, text, at: new Date().toISOString() }); }
  async addAction(action: VoiceAction) { this.actions.push(structuredClone(action)); }
  async updateStatus(callSid: string, status: CallStatus) { const session = this.sessions.get(callSid); if (!session) return; session.status = status; if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) session.endedAt = new Date().toISOString(); }
  async saveSummary(callSid: string, _businessId: string, summary: CallSummary) { this.summaries.set(callSid, structuredClone(summary)); }
}

export class SupabaseVoiceStore implements VoiceStore {
  constructor(private client: SupabaseClient) {}
  async findNumber(phoneNumber: string) { const { data, error } = await this.client.from('voice_numbers').select('*, voice_agent_settings(*)').eq('phone_number', phoneNumber).eq('active', true).maybeSingle(); if (error) throw error; if (!data) return null; const settings = Array.isArray(data.voice_agent_settings) ? data.voice_agent_settings[0] : data.voice_agent_settings; return { businessId: data.business_id, phoneNumber: data.phone_number, businessName: settings?.business_name ?? 'the business', language: settings?.language ?? 'en', greeting: settings?.greeting ?? 'Thank you for calling. I am Marisol, the AI receptionist. How may I help?', transferNumber: settings?.transfer_number ?? undefined, fallbackMessage: settings?.fallback_message ?? 'I can take a message or connect you with a person.', faqs: settings?.faqs ?? [], active: data.active }; }
  async createSession(session: CallSession) { const { error } = await this.client.from('call_sessions').insert({ call_sid: session.callSid, business_id: session.businessId, from_number: session.from, to_number: session.to, language: session.language, status: session.status, transcript: session.turns, started_at: session.startedAt }); if (error) throw error; }
  async getSession(callSid: string) { const { data, error } = await this.client.from('call_sessions').select('*').eq('call_sid', callSid).maybeSingle(); if (error) throw error; return data ? { callSid: data.call_sid, businessId: data.business_id, from: data.from_number, to: data.to_number, language: data.language, status: data.status, turns: data.transcript ?? [], startedAt: data.started_at, endedAt: data.ended_at ?? undefined } : null; }
  async addTurn(callSid: string, role: 'caller' | 'marisol', text: string) { const session = await this.getSession(callSid); if (!session) throw new Error('Call session not found'); session.turns.push({ role, text, at: new Date().toISOString() }); const { error } = await this.client.from('call_sessions').update({ transcript: session.turns }).eq('call_sid', callSid); if (error) throw error; }
  async addAction(action: VoiceAction) { const { error } = await this.client.from('call_actions').insert({ call_sid: action.callSid, business_id: action.businessId, action_type: action.type, payload: action.payload, verified: action.verified, created_at: action.createdAt }); if (error) throw error; }
  async updateStatus(callSid: string, status: CallStatus) { const terminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status); const { error } = await this.client.from('call_sessions').update({ status, ...(terminal ? { ended_at: new Date().toISOString() } : {}) }).eq('call_sid', callSid); if (error) throw error; }
  async saveSummary(callSid: string, businessId: string, summary: CallSummary) { const { error } = await this.client.from('call_sessions').update({ summary }).eq('call_sid', callSid); if (error) throw error; const { error: signalError } = await this.client.from('audit_events').insert({ business_id: businessId, event_type: 'marisol.call.summary', payload: { callSid, ...summary } }); if (signalError) throw signalError; }
}

export function createVoiceStore(): VoiceStore {
  if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseVoiceStore(createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
  if (config.NODE_ENV === 'production') throw new Error('Persistent voice store required in production');
  return new MemoryVoiceStore();
}
