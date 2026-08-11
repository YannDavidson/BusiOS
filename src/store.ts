import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import type { ConversationState } from './domain.js';

export interface Store {
  get(phone: string): Promise<ConversationState | null>;
  put(state: ConversationState): Promise<void>;
  audit(businessId: string, eventType: string, payload: unknown): Promise<void>;
}

export class MemoryStore implements Store {
  private states = new Map<string, ConversationState>();
  async get(phone: string) { return this.states.get(phone) ?? null; }
  async put(state: ConversationState) { this.states.set(state.phone, structuredClone(state)); }
  async audit() { return; }
}

export class SupabaseStore implements Store {
  constructor(private client: SupabaseClient) {}
  async get(phone: string) {
    const { data, error } = await this.client.from('conversation_states').select('*').eq('phone', phone).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { businessId: data.business_id, phone: data.phone, onboardingStep: data.onboarding_step, brain: data.brain, pendingOpportunity: data.pending_opportunity ?? undefined };
  }
  async put(state: ConversationState) {
    const { error } = await this.client.from('conversation_states').upsert({
      business_id: state.businessId, phone: state.phone, onboarding_step: state.onboardingStep,
      brain: state.brain, pending_opportunity: state.pendingOpportunity ?? null, updated_at: new Date().toISOString()
    }, { onConflict: 'phone' });
    if (error) throw error;
  }
  async audit(businessId: string, eventType: string, payload: unknown) {
    const { error } = await this.client.from('audit_events').insert({ business_id: businessId, event_type: eventType, payload });
    if (error) throw error;
  }
}

export function createStore(): Store {
  if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseStore(createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
  }
  if (config.NODE_ENV === 'production') throw new Error('Persistent store required in production');
  return new MemoryStore();
}
