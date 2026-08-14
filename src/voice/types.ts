import type { SupportedLanguage } from '../language.js';

export interface VoiceFaq { question: string; answer: string; keywords: string[]; }
export interface VoiceNumber {
  businessId: string; phoneNumber: string; businessName: string; language: SupportedLanguage;
  greeting: string; transferNumber?: string; fallbackMessage: string; faqs: VoiceFaq[]; active: boolean;
  realtimeEnabled?: boolean; liveVoice?: string; maxDurationSeconds?: number; maxTurns?: number; maxAudioSeconds?: number; maxLatencyMs?: number;
}
export type CallStatus = 'initiated' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled';
export interface CallTurn { role: 'caller' | 'marisol'; text: string; at: string; }
export interface CallSession {
  callSid: string; businessId: string; from: string; to: string; language: SupportedLanguage;
  status: CallStatus; turns: CallTurn[]; startedAt: string; endedAt?: string;
}
export type VoiceActionType = 'faq_answered' | 'message_captured' | 'appointment_simulated' | 'human_transfer' | 'fallback';
export type RealtimeEventType = 'connected' | 'reconnected' | 'interrupted' | 'latency_drop' | 'limit_reached' | 'upstream_error' | 'closed';
export interface VoiceAction { callSid: string; businessId: string; type: VoiceActionType; payload: Record<string, unknown>; verified: boolean; createdAt: string; }
export interface CallSummary { summary: string; intent: string; customerNeeds: string[]; followUp: string[]; }
