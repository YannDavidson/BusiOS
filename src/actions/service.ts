import { randomUUID } from 'node:crypto';
import type { ActionConnector } from './connectors.js';
import type { ActionStore } from './store.js';
import type { ActionKind, ConsentChannel, ConsentPurpose, ExecutionReceipt, VerifiedAction } from './types.js';

export class VerifiedActionService {
  constructor(private store: ActionStore, private connectors: Record<ActionKind, ActionConnector>) {}
  async propose(input: { businessId: string; kind: ActionKind; idempotencyKey: string; payload: Record<string, unknown>; consentId?: string }) {
    const existing = await this.store.getActionByKey(input.businessId, input.idempotencyKey); if (existing) return existing;
    const now = new Date().toISOString(); return this.store.createAction({ id: randomUUID(), ...input, status: 'pending_approval', createdAt: now, updatedAt: now });
  }
  async approveAndExecute(actionId: string, approvedBy: string) {
    const action = await this.store.getAction(actionId); if (!action) throw new Error('Action not found');
    const existingReceipt = await this.store.getReceiptByAction(action.id); if (existingReceipt) return existingReceipt;
    await this.assertConsent(action);
    const approvedAt = new Date().toISOString();
    if (!await this.store.claimAction(action.id, approvedBy, approvedAt)) { const receipt = await this.store.getReceiptByAction(action.id); if (receipt) return receipt; throw new Error(`Action cannot execute from ${action.status}`); }
    try {
      const result = await this.connectors[action.kind].execute({ ...action, status: 'executing', approvedBy, approvedAt }); const now = new Date().toISOString();
      const receipt: ExecutionReceipt = { id: randomUUID(), actionId: action.id, businessId: action.businessId, provider: result.provider, providerResourceId: result.resourceId, status: result.status, verified: result.status === 'verified', details: result.details ?? {}, createdAt: now, updatedAt: now };
      await this.store.addReceipt(receipt); await this.store.updateAction(action.id, result.status === 'verified' ? 'verified' : 'accepted');
      await this.store.addUsage(result.usage.map((event) => ({ ...event, businessId: action.businessId, actionId: action.id, occurredAt: now })));
      return receipt;
    } catch (error) { await this.store.updateAction(action.id, 'failed'); throw error; }
  }
  async providerStatus(providerResourceId: string, providerStatus: string, details: Record<string, unknown>) {
    const receipt = await this.store.findReceiptByProviderId(providerResourceId); if (!receipt) return false;
    const verified = ['delivered', 'read', 'completed'].includes(providerStatus); const failed = ['failed', 'undelivered', 'busy', 'no-answer', 'canceled'].includes(providerStatus);
    await this.store.updateReceipt(receipt.id, failed ? 'failed' : verified ? 'verified' : 'accepted', verified, { ...details, providerStatus });
    await this.store.updateAction(receipt.actionId, failed ? 'failed' : verified ? 'verified' : 'accepted');
    const quantity = Number(details.durationSeconds ?? details.segments ?? 0); if (Number.isFinite(quantity) && quantity > 0) await this.store.addUsage([{ businessId: receipt.businessId, actionId: receipt.actionId, metric: receipt.provider === 'twilio-call' ? 'outbound_call_seconds' : 'message_segments', quantity, estimatedCostMicros: 0, occurredAt: new Date().toISOString() }]);
    return true;
  }
  private async assertConsent(action: VerifiedAction) {
    if (action.kind === 'crm.upsert') return;
    const subject = String(action.payload.to ?? action.payload.subject ?? '');
    const channel: ConsentChannel = action.kind === 'calendar.create' ? 'email' : action.kind === 'callback.place' ? 'voice' : String(action.payload.channel) === 'whatsapp' ? 'whatsapp' : 'sms';
    const purpose: ConsentPurpose = action.kind === 'calendar.create' ? 'appointment' : action.kind === 'callback.place' ? 'callback' : 'transactional_message';
    const consent = await this.store.findConsent(action.businessId, subject.replace(/^whatsapp:/, ''), purpose, channel);
    if (!consent || (action.consentId && consent.id !== action.consentId)) throw new Error(`Active ${purpose} consent is required for ${channel}`);
  }
}
