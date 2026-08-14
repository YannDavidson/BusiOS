import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InternalCrmConnector, type ActionConnector } from '../src/actions/connectors.js';
import { VerifiedActionService } from '../src/actions/service.js';
import { MemoryActionStore } from '../src/actions/store.js';
import { decryptCredentials, encryptCredentials } from '../src/actions/vault.js';
import type { ActionKind, ConnectorResult } from '../src/actions/types.js';

class FakeConnector implements ActionConnector {
  calls = 0;
  constructor(private result: ConnectorResult) {}
  async execute() { this.calls++; return this.result; }
}

function setup() {
  const store = new MemoryActionStore();
  const message = new FakeConnector({ provider: 'twilio-message', resourceId: 'SM123', status: 'accepted', usage: [{ metric: 'sms_segment_estimate', quantity: 1, estimatedCostMicros: 0 }] });
  const calendar = new FakeConnector({ provider: 'google-calendar', resourceId: 'event-1', status: 'verified', usage: [{ metric: 'calendar_event_created', quantity: 1, estimatedCostMicros: 0 }] });
  const callback = new FakeConnector({ provider: 'twilio-call', resourceId: 'CA123', status: 'accepted', usage: [{ metric: 'outbound_call_attempt', quantity: 1, estimatedCostMicros: 0 }] });
  const connectors: Record<ActionKind, ActionConnector> = { 'calendar.create': calendar, 'crm.upsert': new InternalCrmConnector(store), 'confirmation.send': message, 'callback.place': callback };
  return { store, message, calendar, callback, service: new VerifiedActionService(store, connectors) };
}

describe('verified phone actions', () => {
  it('deduplicates proposals and never executes before approval', async () => {
    const { service, message } = setup();
    const input = { businessId: 'b1', kind: 'confirmation.send' as const, idempotencyKey: 'confirm-1', payload: { to: '+15550001', from: '+15125550100', channel: 'sms', body: 'Confirmed' } };
    const first = await service.propose(input), second = await service.propose(input);
    expect(second.id).toBe(first.id); expect(message.calls).toBe(0);
  });
  it('blocks a confirmation without active channel-specific consent', async () => {
    const { service } = setup(); const action = await service.propose({ businessId: 'b1', kind: 'confirmation.send', idempotencyKey: 'confirm-1', payload: { to: '+15550001', from: '+15125550100', channel: 'sms', body: 'Confirmed' } });
    await expect(service.approveAndExecute(action.id, 'owner-1')).rejects.toThrow('consent');
  });
  it('creates an accepted receipt then verifies it only from provider status', async () => {
    const { store, service, message } = setup(); const consentId = randomUUID();
    await store.addConsent({ id: consentId, businessId: 'b1', subject: '+15550001', purpose: 'transactional_message', channel: 'sms', status: 'granted', source: 'customer_request', evidence: { callSid: 'CA0' }, grantedAt: new Date().toISOString() });
    const action = await service.propose({ businessId: 'b1', kind: 'confirmation.send', idempotencyKey: 'confirm-1', payload: { to: '+15550001', from: '+15125550100', channel: 'sms', body: 'Confirmed' }, consentId });
    const accepted = await service.approveAndExecute(action.id, 'owner-1'); expect(accepted.verified).toBe(false); expect(message.calls).toBe(1);
    expect(await service.providerStatus('SM123', 'delivered', { segments: 1 })).toBe(true);
    expect((await store.getReceiptByAction(action.id))?.verified).toBe(true);
    expect(store.usage.map((item) => item.metric)).toEqual(['sms_segment_estimate', 'message_segments']);
    await service.approveAndExecute(action.id, 'owner-1'); expect(message.calls).toBe(1);
  });
  it('immediately verifies Calendar and internal CRM resource IDs', async () => {
    const { service, store } = setup();
    const consentId = randomUUID(); await store.addConsent({ id: consentId, businessId: 'b1', subject: 'ada@example.com', purpose: 'appointment', channel: 'email', status: 'granted', source: 'customer_request', evidence: {}, grantedAt: new Date().toISOString() });
    const calendar = await service.propose({ businessId: 'b1', kind: 'calendar.create', idempotencyKey: 'event-1', payload: { subject: 'ada@example.com', event: { summary: 'Appointment' } }, consentId });
    expect((await service.approveAndExecute(calendar.id, 'owner'))?.verified).toBe(true);
    const crm = await service.propose({ businessId: 'b1', kind: 'crm.upsert', idempotencyKey: 'contact-1', payload: { externalKey: '+15550001', name: 'Ada' } });
    expect((await service.approveAndExecute(crm.id, 'owner'))?.provider).toBe('busios-crm');
    expect(store.contacts.get('b1:+15550001')?.name).toBe('Ada');
  });
  it('lets a later revocation override an older consent grant', async () => {
    const { service, store } = setup(); const now = new Date();
    await store.addConsent({ id: randomUUID(), businessId: 'b1', subject: '+15550001', purpose: 'callback', channel: 'voice', status: 'granted', source: 'call', evidence: {}, grantedAt: new Date(now.getTime() - 1000).toISOString() });
    await store.addConsent({ id: randomUUID(), businessId: 'b1', subject: '+15550001', purpose: 'callback', channel: 'voice', status: 'revoked', source: 'opt_out', evidence: {}, grantedAt: now.toISOString(), revokedAt: now.toISOString() });
    const action = await service.propose({ businessId: 'b1', kind: 'callback.place', idempotencyKey: 'call-1', payload: { to: '+15550001', from: '+15125550100', approvedMessage: 'This is your requested callback.' } });
    await expect(service.approveAndExecute(action.id, 'owner')).rejects.toThrow('consent');
  });
  it('encrypts OAuth refresh credentials with authenticated encryption', () => {
    const encrypted = encryptCredentials({ refreshToken: 'secret-token' }, 'test-key-at-least-32-characters-long');
    expect(encrypted).not.toContain('secret-token');
    expect(decryptCredentials<{ refreshToken: string }>(encrypted, 'test-key-at-least-32-characters-long').refreshToken).toBe('secret-token');
  });
});
