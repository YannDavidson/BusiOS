import { describe, expect, it } from 'vitest';
import { MarisolVoiceService } from '../src/voice/marisol.js';
import { MemoryVoiceStore } from '../src/voice/store.js';

function setup() {
  const store = new MemoryVoiceStore();
  store.numbers.set('+15125550100', { businessId: 'business-a', phoneNumber: '+15125550100', businessName: 'Keli Hair Studio', language: 'en', greeting: 'Thank you for calling Keli Hair Studio.', fallbackMessage: 'I can take a message or connect you.', transferNumber: '+15125550199', active: true, faqs: [{ question: 'hours', answer: 'We are open Monday through Saturday.', keywords: ['hours', 'open'] }] });
  const service = new MarisolVoiceService(store, { summarizeCall: async () => ({ summary: 'Caller asked about hours.', intent: 'faq', customerNeeds: ['Business hours'], followUp: [] }) });
  return { store, service };
}

describe('Marisol voice foundation', () => {
  it('isolates tenants by the called Twilio number and discloses AI', async () => {
    const { store, service } = setup();
    store.numbers.set('+15125550200', { businessId: 'business-b', phoneNumber: '+15125550200', businessName: 'Other Shop', language: 'es', greeting: 'Gracias por llamar a Other Shop.', fallbackMessage: 'Puedo tomar un mensaje.', active: true, faqs: [] });
    const first = await service.answer('CA1', '+15550001', '+15125550100');
    const second = await service.answer('CA2', '+15550002', '+15125550200');
    expect(first.number.businessId).toBe('business-a');
    expect(second.number.businessId).toBe('business-b');
    expect(second.greeting).toContain('inteligencia artificial');
  });
  it('answers only approved FAQs and audits verified action', async () => {
    const { store, service } = setup(); await service.answer('CA1', '+15550001', '+15125550100');
    const result = await service.turn('CA1', 'What are your hours?');
    expect(result.text).toContain('Monday through Saturday');
    expect(store.actions[0]).toMatchObject({ type: 'faq_answered', verified: true, businessId: 'business-a' });
  });
  it('simulates appointments and never marks them verified', async () => {
    const { store, service } = setup(); await service.answer('CA1', '+15550001', '+15125550100');
    const result = await service.turn('CA1', 'I want to book an appointment Tuesday');
    expect(result.text).toContain('does not confirm');
    expect(store.actions[0]).toMatchObject({ type: 'appointment_simulated', verified: false });
  });
  it('transfers to the configured human and summarizes terminal calls for Diego', async () => {
    const { store, service } = setup(); await service.answer('CA1', '+15550001', '+15125550100');
    expect(await service.turn('CA1', 'I need a human representative')).toMatchObject({ kind: 'transfer', number: '+15125550199' });
    await service.status('CA1', 'completed');
    expect(store.summaries.get('CA1')?.intent).toBe('faq');
  });
});
