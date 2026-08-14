import type { SupportedLanguage } from '../language.js';
import type { CallSession, CallSummary, VoiceAction, VoiceNumber } from './types.js';
import type { VoiceStore } from './store.js';

export interface VoiceSummaryIntelligence { summarizeCall(session: CallSession): Promise<CallSummary>; }
export type VoiceTurn = { kind: 'say'; text: string } | { kind: 'transfer'; text: string; number: string } | { kind: 'hangup'; text: string };

export class MarisolVoiceService {
  constructor(private store: VoiceStore, private intelligence: VoiceSummaryIntelligence) {}
  async answer(callSid: string, from: string, to: string): Promise<{ number: VoiceNumber; greeting: string }> {
    const number = await this.store.findNumber(to);
    if (!number) throw new Error('Voice number is not assigned to an active business');
    const greeting = `${number.greeting} ${disclosure(number.language)}`;
    await this.store.createSession({ callSid, businessId: number.businessId, from, to, language: number.language, status: 'in-progress', turns: [{ role: 'marisol', text: greeting, at: new Date().toISOString() }], startedAt: new Date().toISOString() });
    return { number, greeting };
  }
  async turn(callSid: string, speech: string): Promise<VoiceTurn> {
    const session = await this.store.getSession(callSid); if (!session) throw new Error('Call session not found');
    const number = await this.store.findNumber(session.to); if (!number) throw new Error('Voice number is no longer active');
    await this.store.addTurn(callSid, 'caller', speech);
    const normalized = speech.toLowerCase();
    if (/\b(person|human|representative|agent|persona|humano|representante|pessoa|atendente)\b/i.test(normalized)) {
      if (number.transferNumber) return this.respond(session, { kind: 'transfer', text: transferCopy(session.language), number: number.transferNumber }, 'human_transfer', { number: number.transferNumber });
      return this.respond(session, { kind: 'say', text: number.fallbackMessage }, 'message_captured', { message: speech, reason: 'transfer unavailable' });
    }
    const faq = number.faqs.find((item) => item.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())));
    if (faq) return this.respond(session, { kind: 'say', text: `${faq.answer} ${anythingElse(session.language)}` }, 'faq_answered', { question: faq.question });
    if (/\b(appointment|book|schedule|cita|reservar|agendar|consulta)\b/i.test(normalized)) return this.respond(session, { kind: 'say', text: appointmentCopy(session.language) }, 'appointment_simulated', { request: speech, status: 'simulation_only' });
    if (/\b(message|recado|mensaje|dejar.*mensaje|leave.*message)\b/i.test(normalized)) return this.respond(session, { kind: 'hangup', text: messageCopy(session.language) }, 'message_captured', { message: speech });
    return this.respond(session, { kind: 'say', text: number.fallbackMessage }, 'fallback', { utterance: speech });
  }
  async status(callSid: string, status: CallSession['status']) {
    await this.store.updateStatus(callSid, status);
    if (!['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) return;
    const session = await this.store.getSession(callSid); if (!session || !session.turns.length) return;
    const summary = await this.intelligence.summarizeCall(session);
    await this.store.saveSummary(callSid, session.businessId, summary);
  }
  private async respond(session: CallSession, result: VoiceTurn, type: VoiceAction['type'], payload: Record<string, unknown>) {
    await this.store.addTurn(session.callSid, 'marisol', result.text);
    await this.store.addAction({ callSid: session.callSid, businessId: session.businessId, type, payload, verified: type === 'faq_answered' || type === 'message_captured' || type === 'fallback', createdAt: new Date().toISOString() });
    return result;
  }
}

function disclosure(language: SupportedLanguage) { return language === 'es' ? 'Soy Marisol, la recepcionista virtual de inteligencia artificial.' : language === 'pt' ? 'Sou Marisol, a recepcionista virtual de inteligência artificial.' : 'I am Marisol, the AI receptionist.'; }
function anythingElse(language: SupportedLanguage) { return language === 'es' ? '¿En qué más puedo ayudarte?' : language === 'pt' ? 'Como mais posso ajudar?' : 'What else can I help you with?'; }
function transferCopy(language: SupportedLanguage) { return language === 'es' ? 'Claro. Te comunicaré con una persona.' : language === 'pt' ? 'Claro. Vou transferir você para uma pessoa.' : 'Certainly. I will connect you with a person.'; }
function appointmentCopy(language: SupportedLanguage) { return language === 'es' ? 'Puedo preparar una solicitud de cita. Esta demostración no confirma el horario todavía. Dime el servicio, día y hora que prefieres.' : language === 'pt' ? 'Posso preparar uma solicitação de agendamento. Esta demonstração ainda não confirma o horário. Diga o serviço, dia e horário desejados.' : 'I can prepare an appointment request. This demonstration does not confirm the time yet. Tell me the service, day, and time you prefer.'; }
function messageCopy(language: SupportedLanguage) { return language === 'es' ? 'Gracias. Guardé tu mensaje para que el negocio pueda darle seguimiento. Adiós.' : language === 'pt' ? 'Obrigada. Registrei sua mensagem para que a empresa possa responder. Até logo.' : 'Thank you. I saved your message for the business to follow up. Goodbye.'; }
