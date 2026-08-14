export type ActionKind = 'calendar.create' | 'crm.upsert' | 'confirmation.send' | 'callback.place';
export type ActionStatus = 'pending_approval' | 'approved' | 'executing' | 'accepted' | 'verified' | 'failed' | 'cancelled';
export type ConsentPurpose = 'service' | 'appointment' | 'transactional_message' | 'callback' | 'marketing';
export type ConsentChannel = 'voice' | 'sms' | 'whatsapp' | 'email';

export interface VerifiedAction {
  id: string; businessId: string; kind: ActionKind; status: ActionStatus; idempotencyKey: string;
  payload: Record<string, unknown>; consentId?: string; approvedBy?: string; approvedAt?: string;
  createdAt: string; updatedAt: string;
}
export interface ConsentRecord {
  id: string; businessId: string; subject: string; purpose: ConsentPurpose; channel: ConsentChannel;
  status: 'granted' | 'revoked'; source: string; evidence: Record<string, unknown>; grantedAt: string; revokedAt?: string;
}
export interface ExecutionReceipt {
  id: string; actionId: string; businessId: string; provider: string; providerResourceId: string;
  status: 'accepted' | 'verified' | 'failed'; verified: boolean; details: Record<string, unknown>; createdAt: string; updatedAt: string;
}
export interface UsageEvent { businessId: string; actionId: string; metric: string; quantity: number; estimatedCostMicros: number; occurredAt: string; }
export interface ConnectorResult { provider: string; resourceId: string; status: 'accepted' | 'verified'; details?: Record<string, unknown>; usage: Omit<UsageEvent, 'businessId' | 'actionId' | 'occurredAt'>[]; }
