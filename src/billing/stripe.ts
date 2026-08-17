import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

export type PaidPlan = 'basic' | 'growth' | 'business';
export const pricing = { basic: { amount: 11900, agents: 2 }, growth: { amount: 16900, agents: 4 }, business: { amount: 29900, agents: 8 } } as const;

interface BillingAccount { businessId: string; planCode: string; stripeCustomerId?: string; stripeSubscriptionId?: string; subscriptionStatus?: string; }
export interface BillingStore {
  get(businessId: string): Promise<BillingAccount | null>;
  saveCustomer(businessId: string, customerId: string): Promise<void>;
  applySubscription(value: { businessId: string; customerId: string; subscriptionId: string; plan: PaidPlan; status: string; cancelAtPeriodEnd: boolean }): Promise<void>;
  eventProcessed(eventId: string): Promise<boolean>;
  recordEvent(eventId: string, type: string): Promise<void>;
  completeEvent(eventId: string): Promise<void>;
}

export interface StripeGateway {
  createCustomer(email: string, businessId: string): Promise<string>;
  checkout(input: { customerId: string; businessId: string; priceId: string; successUrl: string; cancelUrl: string }): Promise<string>;
  portal(customerId: string, returnUrl: string): Promise<string>;
  constructEvent(payload: Buffer, signature: string, secret: string): Stripe.Event;
}

export class StripeApi implements StripeGateway {
  private client: Stripe;
  constructor(secret = config.STRIPE_SECRET_KEY) { if (!secret) throw new Error('Stripe is not configured'); this.client = new Stripe(secret); }
  async createCustomer(email: string, businessId: string) { const value = await this.client.customers.create({ email, metadata: { businessId } }, { idempotencyKey: `busios-customer-${businessId}` }); return value.id; }
  async checkout(input: { customerId: string; businessId: string; priceId: string; successUrl: string; cancelUrl: string }) { const value = await this.client.checkout.sessions.create({ mode: 'subscription', customer: input.customerId, client_reference_id: input.businessId, line_items: [{ price: input.priceId, quantity: 1 }], success_url: input.successUrl, cancel_url: input.cancelUrl, allow_promotion_codes: true, metadata: { businessId: input.businessId }, subscription_data: { metadata: { businessId: input.businessId } } }); if (!value.url) throw new Error('Stripe Checkout did not return a URL'); return value.url; }
  async portal(customerId: string, returnUrl: string) { const value = await this.client.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl }); return value.url; }
  constructEvent(payload: Buffer, signature: string, secret: string) { return this.client.webhooks.constructEvent(payload, signature, secret); }
}

export class MemoryBillingStore implements BillingStore {
  accounts = new Map<string, BillingAccount>(); events = new Map<string, { type: string; completed: boolean }>();
  async get(id: string) { return this.accounts.get(id) ?? null; }
  async saveCustomer(id: string, customerId: string) { this.accounts.set(id, { ...(this.accounts.get(id) ?? { businessId: id, planCode: 'pilot' }), stripeCustomerId: customerId }); }
  async applySubscription(v: { businessId: string; customerId: string; subscriptionId: string; plan: PaidPlan; status: string; cancelAtPeriodEnd: boolean }) { this.accounts.set(v.businessId, { businessId: v.businessId, planCode: v.plan, stripeCustomerId: v.customerId, stripeSubscriptionId: v.subscriptionId, subscriptionStatus: v.status }); }
  async eventProcessed(id: string) { return this.events.get(id)?.completed ?? false; }
  async recordEvent(id: string, type: string) { if (!this.events.has(id)) this.events.set(id, { type, completed: false }); }
  async completeEvent(id: string) { const event = this.events.get(id); if (event) event.completed = true; }
}

export class SupabaseBillingStore implements BillingStore {
  constructor(private client: SupabaseClient) {}
  async get(id: string) { const { data, error } = await this.client.from('billing_accounts').select('*').eq('business_id', id).maybeSingle(); if (error) throw error; return data ? { businessId: data.business_id, planCode: data.plan_code, stripeCustomerId: data.stripe_customer_id ?? undefined, stripeSubscriptionId: data.stripe_subscription_id ?? undefined, subscriptionStatus: data.subscription_status ?? undefined } : null; }
  async saveCustomer(id: string, customerId: string) { const { error } = await this.client.from('billing_accounts').upsert({ business_id: id, stripe_customer_id: customerId, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }); if (error) throw error; }
  async applySubscription(v: { businessId: string; customerId: string; subscriptionId: string; plan: PaidPlan; status: string; cancelAtPeriodEnd: boolean }) { const { error } = await this.client.from('billing_accounts').upsert({ business_id: v.businessId, plan_code: v.plan, status: ['active', 'trialing', 'past_due'].includes(v.status) ? 'active' : 'paused', stripe_customer_id: v.customerId, stripe_subscription_id: v.subscriptionId, subscription_status: v.status, cancel_at_period_end: v.cancelAtPeriodEnd, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }); if (error) throw error; }
  async eventProcessed(id: string) { const { data, error } = await this.client.from('stripe_webhook_events').select('processed_at').eq('event_id', id).maybeSingle(); if (error) throw error; return Boolean(data?.processed_at); }
  async recordEvent(id: string, type: string) { const { error } = await this.client.from('stripe_webhook_events').upsert({ event_id: id, event_type: type, received_at: new Date().toISOString() }, { onConflict: 'event_id', ignoreDuplicates: true }); if (error) throw error; }
  async completeEvent(id: string) { const { error } = await this.client.from('stripe_webhook_events').update({ processed_at: new Date().toISOString() }).eq('event_id', id); if (error) throw error; }
}

export class StripeBillingService {
  constructor(private store: BillingStore, private stripe: StripeGateway = new StripeApi()) {}
  async checkout(businessId: string, email: string, plan: PaidPlan) { const priceId = priceFor(plan); let account = await this.store.get(businessId); if (account?.stripeSubscriptionId && ['active', 'trialing', 'past_due'].includes(account.subscriptionStatus ?? '')) throw new Error('Manage your existing subscription in the billing portal'); if (!account?.stripeCustomerId) { const customerId = await this.stripe.createCustomer(email, businessId); await this.store.saveCustomer(businessId, customerId); account = await this.store.get(businessId); } return { url: await this.stripe.checkout({ customerId: account!.stripeCustomerId!, businessId, priceId, successUrl: `${base()}/portal/?billing=success`, cancelUrl: `${base()}/portal/pricing.html?billing=cancelled` }) }; }
  async portal(businessId: string) { const account = await this.store.get(businessId); if (!account?.stripeCustomerId) throw new Error('No Stripe billing account exists yet'); return { url: await this.stripe.portal(account.stripeCustomerId, `${base()}/portal/`) }; }
  async webhook(payload: Buffer, signature: string) { if (!config.STRIPE_WEBHOOK_SECRET) throw new Error('Stripe webhook secret is not configured'); const event = this.stripe.constructEvent(payload, signature, config.STRIPE_WEBHOOK_SECRET); if (await this.store.eventProcessed(event.id)) return false; await this.store.recordEvent(event.id, event.type); if (event.type.startsWith('customer.subscription.')) await this.syncSubscription(event.data.object as Stripe.Subscription); await this.store.completeEvent(event.id); return true; }
  private async syncSubscription(subscription: Stripe.Subscription) { const businessId = subscription.metadata.businessId; const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id; const priceId = subscription.items.data[0]?.price.id; const plan = planFor(priceId); if (!businessId || !plan) throw new Error('Stripe subscription is missing BusiOS metadata or a recognized price'); await this.store.applySubscription({ businessId, customerId, subscriptionId: subscription.id, plan, status: subscription.status, cancelAtPeriodEnd: subscription.cancel_at_period_end }); }
}

export function createStripeBillingService() { if (!config.STRIPE_SECRET_KEY) return undefined; if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) return new StripeBillingService(new SupabaseBillingStore(createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }))); if (config.NODE_ENV === 'production') throw new Error('Persistent billing store required'); return new StripeBillingService(new MemoryBillingStore()); }
function base() { if (!config.PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL is required'); return config.PUBLIC_BASE_URL.replace(/\/$/, ''); }
function priceFor(plan: PaidPlan) { const id = ({ basic: config.STRIPE_PRICE_BASIC_ID, growth: config.STRIPE_PRICE_GROWTH_ID, business: config.STRIPE_PRICE_BUSINESS_ID })[plan]; if (!id) throw new Error(`Stripe price is not configured for ${plan}`); return id; }
function planFor(priceId?: string): PaidPlan | undefined { return (Object.entries({ basic: config.STRIPE_PRICE_BASIC_ID, growth: config.STRIPE_PRICE_GROWTH_ID, business: config.STRIPE_PRICE_BUSINESS_ID }).find(([, id]) => id === priceId)?.[0]) as PaidPlan | undefined; }
