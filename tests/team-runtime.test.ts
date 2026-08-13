import { describe, expect, it } from 'vitest';
import { MultiAgentRuntime, type TeamIntelligence } from '../src/team-runtime.js';
import { MemoryStore } from '../src/store.js';
import type { IntelligenceEngine } from '../src/diego.js';
import { Orchestrator } from '../src/orchestrator.js';

const teamIntelligence: TeamIntelligence = {
  planTeam: async () => ({
    objective: 'Balance weekday and Saturday demand',
    rationale: 'Demand, capacity, margin, promotion, and follow-up must be evaluated together.',
    assignments: [
      { agent: 'MARISOL', objective: 'Analyze inquiry and appointment patterns', risk: 'informational', requiresOwnerApproval: false },
      { agent: 'ENRIQUE', objective: 'Identify safe weekday capacity', risk: 'informational', requiresOwnerApproval: false },
      { agent: 'LOLA', objective: 'Calculate a profitable promotion floor', risk: 'consequential', requiresOwnerApproval: true },
      { agent: 'MIGUEL', objective: 'Draft a weekday campaign', risk: 'reversible', requiresOwnerApproval: true },
      { agent: 'ZULMA', objective: 'Draft dormant-lead follow-up', risk: 'reversible', requiresOwnerApproval: true }
    ],
    conflictsToResolve: ['Promotion strength versus margin'], requiresOwnerApproval: true
  }),
  runSpecialist: async (agent) => ({ summary: `${agent} completed analysis`, findings: ['Verified finding'], proposedActions: ['Draft only'], assumptions: ['Sample data'], confidence: 0.8, executionReady: true }),
  synthesizeTeam: async () => 'Diego synthesized five specialist findings. No external action was executed.'
};

const diego: IntelligenceEngine = { respond: async () => 'Diego response', detectOpportunity: async () => { throw new Error('not used'); } };

async function completedOwner(store: MemoryStore) {
  await store.put({ businessId: '11111111-1111-1111-1111-111111111111', phone: 'whatsapp:+1', language: 'en', onboardingStep: 10, brain: { identity: 'Demo shop' } });
}

describe('durable multi-agent runtime', () => {
  it('creates a durable approval-gated run and specialist tasks', async () => {
    const store = new MemoryStore();
    const runtime = new MultiAgentRuntime(store, teamIntelligence);
    const run = await runtime.plan('business-1', {}, 'Weekdays are slow but Saturday is full', 'en');
    expect(run.status).toBe('awaiting_approval');
    expect(await store.getRunTasks(run.id)).toHaveLength(5);
    expect((await store.getTeamRun(run.id))?.plan.assignments[0]?.agent).toBe('MARISOL');
  });

  it('executes only after approval and forces results to draft-only', async () => {
    const store = new MemoryStore();
    const runtime = new MultiAgentRuntime(store, teamIntelligence);
    const run = await runtime.plan('business-1', {}, 'Balance demand', 'en');
    const completed = await runtime.execute(run, {});
    expect(completed.status).toBe('completed');
    expect(completed.synthesis).toContain('No external action');
    expect((await store.getRunTasks(run.id)).every((task) => task.result?.executionReady === false)).toBe(true);
  });

  it('supports PLAN, STATUS, TEAM, APPROVE, MEMORY, CORRECT, ASK, and CANCEL commands', async () => {
    const store = new MemoryStore();
    await completedOwner(store);
    const runtime = new MultiAgentRuntime(store, teamIntelligence);
    const orchestrator = new Orchestrator(store, diego, runtime);
    expect(await orchestrator.handle('whatsapp:+1', 'TEAM')).toContain('Chief Intelligence Officer');
    expect(await orchestrator.handle('whatsapp:+1', 'MEMORY')).toContain('Demo shop');
    expect(await orchestrator.handle('whatsapp:+1', 'CORRECT identity=Updated shop')).toContain('Updated identity');
    expect(await orchestrator.handle('whatsapp:+1', 'ASK LOLA analyze cash flow')).toContain('LOLA completed analysis');
    expect(await orchestrator.handle('whatsapp:+1', 'PLAN Weekdays are slow but Saturday is full')).toContain('Reply *APPROVE*');
    expect(await orchestrator.handle('whatsapp:+1', 'STATUS')).toContain('AWAITING_APPROVAL');
    expect(await orchestrator.handle('whatsapp:+1', 'APPROVE')).toContain('No external action was executed');
    expect((await store.get('whatsapp:+1'))?.pendingRunId).toBeUndefined();
    await orchestrator.handle('whatsapp:+1', 'PLAN Create another campaign');
    expect(await orchestrator.handle('whatsapp:+1', 'CANCEL')).toContain('cancelled');
  });
});
