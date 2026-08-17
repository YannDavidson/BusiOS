import { beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { config } from '../src/config.js';
import { MemoryBillingStore, StripeBillingService, type StripeGateway } from '../src/billing/stripe.js';

class FakeStripe implements StripeGateway {
  checkoutPrice?: string; event?: Stripe.Event;
  async createCustomer() { return 'cus_test'; }
  async checkout(input: { priceId: string }) { this.checkoutPrice = input.priceId; return 'https://checkout.stripe.test/session'; }
  async portal() { return 'https://billing.stripe.test/session'; }
  constructEvent() { if (!this.event) throw new Error('Invalid signature'); return this.event; }
}

describe('Stripe billing', () => {
  beforeEach(() => { config.PUBLIC_BASE_URL = 'https://busios.example'; config.STRIPE_WEBHOOK_SECRET = 'whsec_test'; config.STRIPE_PRICE_BASIC_ID = 'price_basic'; config.STRIPE_PRICE_GROWTH_ID = 'price_growth'; config.STRIPE_PRICE_BUSINESS_ID = 'price_business'; });
  it('creates a customer and fixed-price subscription checkout', async () => {
    const store = new MemoryBillingStore(), stripe = new FakeStripe(), service = new StripeBillingService(store, stripe);
    const result = await service.checkout('business-1', 'owner@example.com', 'growth');
    expect(result.url).toContain('checkout.stripe.test'); expect(stripe.checkoutPrice).toBe('price_growth'); expect((await store.get('business-1'))?.stripeCustomerId).toBe('cus_test');
  });
  it('blocks duplicate checkout for an active subscription', async () => {
    const store = new MemoryBillingStore(), service = new StripeBillingService(store, new FakeStripe());
    await store.applySubscription({ businessId: 'business-1', customerId: 'cus_test', subscriptionId: 'sub_test', plan: 'basic', status: 'active', cancelAtPeriodEnd: false });
    await expect(service.checkout('business-1', 'owner@example.com', 'business')).rejects.toThrow('billing portal');
  });
  it('updates entitlements once from a verified subscription event', async () => {
    const store = new MemoryBillingStore(), stripe = new FakeStripe(), service = new StripeBillingService(store, stripe);
    stripe.event = { id: 'evt_1', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, metadata: { businessId: 'business-1' }, items: { data: [{ price: { id: 'price_business' } }] } } } } as unknown as Stripe.Event;
    expect(await service.webhook(Buffer.from('{}'), 'valid')).toBe(true); expect(await service.webhook(Buffer.from('{}'), 'valid')).toBe(false); expect((await store.get('business-1'))?.planCode).toBe('business');
  });
});
