import { describe, expect, it } from 'vitest';
import type { IntelligenceEngine } from '../src/diego.js';
import { Orchestrator } from '../src/orchestrator.js';
import { MemoryStore } from '../src/store.js';

const diego: IntelligenceEngine = {
  respond: async () => 'analysis',
  detectOpportunity: async () => ({
    insight_title: 'Fill Tuesday capacity', observation: 'Weekend demand is high while Tuesday utilization is low.',
    recommendation: 'Offer waitlisted customers a Tuesday booking.', predicted_impact: '+$420', confidence_score: 0.88,
    evidence: [{ source: 'MARISOL', signal: '14 unbooked calls' }],
    execution_payload: { target_agents: ['MIGUEL', 'MARISOL'], action_plan: [{ agent: 'MIGUEL', action: 'Draft campaign' }], requires_owner_approval: true }
  })
};

describe('Orchestrator', () => {
  it('starts conversational onboarding', async () => {
    const result = await new Orchestrator(new MemoryStore(), diego).handle('whatsapp:+1', 'hello');
    expect(result).toContain('1/10');
  });
  it('never executes an opportunity without explicit approval', async () => {
    const store = new MemoryStore();
    const orchestrator = new Orchestrator(store, diego);
    await orchestrator.handle('whatsapp:+2', 'hello');
    for (let i = 0; i < 10; i++) await orchestrator.handle('whatsapp:+2', `answer ${i}`);
    const card = await orchestrator.handle('whatsapp:+2', 'signals: weekend busy, Tuesday empty');
    expect(card).toContain('Reply *APPROVE*');
    expect((await store.get('whatsapp:+2'))?.pendingOpportunity).toBeDefined();
  });
});
