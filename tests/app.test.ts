import { describe, expect, it } from 'vitest';
import type { IntelligenceEngine } from '../src/diego.js';
import { createApp } from '../src/app.js';
import { Orchestrator } from '../src/orchestrator.js';
import { MemoryStore } from '../src/store.js';
import { MarisolVoiceService } from '../src/voice/marisol.js';
import { MemoryVoiceStore } from '../src/voice/store.js';

const intelligence: IntelligenceEngine = {
  respond: async () => 'ok',
  detectOpportunity: async () => { throw new Error('not used'); }
};

describe('HTTP app', () => {
  it('reports service health', async () => {
    const app = createApp(new Orchestrator(new MemoryStore(), intelligence));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'busios-ai' });
    server.close();
  });
  it('serves the owner portal from the production application', async () => {
    const app = createApp(new Orchestrator(new MemoryStore(), intelligence));
    const server = app.listen(0); const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    const response = await fetch(`http://127.0.0.1:${address.port}/portal/`); const html = await response.text();
    expect(response.status).toBe(200); expect(html).toContain('BusiOS Owner Portal'); expect(html).toContain('/portal/app.js');
    const pricing = await fetch(`http://127.0.0.1:${address.port}/portal/pricing.html`); expect(await pricing.text()).toContain('$299');
    server.close();
  });
  it('answers a tenant-routed Twilio voice webhook with TwiML speech gathering', async () => {
    const voiceStore = new MemoryVoiceStore();
    voiceStore.numbers.set('+15125550100', { businessId: 'business-a', phoneNumber: '+15125550100', businessName: 'Keli Hair Studio', language: 'en', greeting: 'Thank you for calling Keli Hair Studio.', fallbackMessage: 'I can take a message.', active: true, faqs: [] });
    const voice = new MarisolVoiceService(voiceStore, { summarizeCall: async () => ({ summary: 'Call', intent: 'unknown', customerNeeds: [], followUp: [] }) });
    const app = createApp(new Orchestrator(new MemoryStore(), intelligence), voice);
    const server = app.listen(0); const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    const body = new URLSearchParams({ CallSid: 'CA123', From: '+15550001', To: '+15125550100' });
    const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/twilio/voice`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain('<Gather');
    expect(xml).toContain('Keli Hair Studio');
    expect(xml).toContain('AI receptionist');
    expect((await voiceStore.getSession('CA123'))?.businessId).toBe('business-a');
    server.close();
  });
});
