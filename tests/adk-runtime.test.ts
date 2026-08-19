import { describe, expect, it } from 'vitest';
import { buildAdkAgentTeam, parsePilotAgents } from '../src/adk/personas.js';
import { buildMetrics, evaluatePlan, evaluateSpecialistResult } from '../src/adk/evaluations.js';
import { FailoverTeamIntelligence } from '../src/adk/runtime.js';
import { MemoryStore } from '../src/store.js';
import type { VerifiedActionService } from '../src/actions/service.js';
import type { TeamIntelligence } from '../src/team-runtime.js';

const actionService = { propose: async () => ({ id: 'action-1', status: 'pending_approval' }) } as unknown as VerifiedActionService;

describe('Google ADK runtime adapter', () => {
  it('converts all personas into ADK agents and gives Diego only the pilot specialists', () => {
    const pilot = parsePilotAgents('miguel, lola');
    const team = buildAdkAgentTeam({ model: 'gemini-test', pilotAgents: pilot, actionService });
    expect(team.agents.size).toBe(8);
    expect(team.root.name).toBe('Diego');
    expect(team.root.subAgents.map((agent) => agent.name)).toEqual(['Miguel', 'Lola']);
    expect(team.agents.get('MARISOL')?.name).toBe('Marisol');
  });

  it('rejects routing outside the pilot and evaluates draft-only quality', () => {
    const plan = {
      objective: 'Grow weekdays', rationale: 'Use marketing and finance evidence.',
      assignments: [{ agent: 'MARISOL' as const, objective: 'Analyze calls', risk: 'informational' as const, requiresOwnerApproval: false }],
      conflictsToResolve: [], requiresOwnerApproval: false
    };
    expect(evaluatePlan(plan, new Set(['MIGUEL', 'LOLA']))).toEqual({ passed: false, invalidRoutes: ['MARISOL'] });
    expect(evaluateSpecialistResult({ summary: 'Draft ready', findings: ['Demand'], proposedActions: [], assumptions: [], confidence: 0.8, executionReady: false }).passed).toBe(true);
  });

  it('records deterministic latency and token cost metrics', () => {
    const metrics = buildMetrics({
      context: { businessId: 'business-1', operation: 'plan', agent: 'DIEGO' }, durationMs: 1200,
      inputTokens: 1000, outputTokens: 500, qualityPassed: true,
      budget: { maxLatencyMs: 2000, inputCostPerMillion: 1, outputCostPerMillion: 2 }
    });
    expect(metrics.passedLatency).toBe(true);
    expect(metrics.estimatedCostMicros).toBe(2000);
  });

  it('falls back immediately when ADK fails', async () => {
    const primary = { planTeam: async () => { throw new Error('ADK unavailable'); } } as unknown as TeamIntelligence;
    const fallback = { planTeam: async () => ({ objective: 'Fallback', rationale: 'Keep the existing runtime available.', assignments: [{ agent: 'MIGUEL', objective: 'Draft campaign', risk: 'informational', requiresOwnerApproval: false }], conflictsToResolve: [], requiresOwnerApproval: false }) } as unknown as TeamIntelligence;
    const runtime = new FailoverTeamIntelligence(primary, fallback, new MemoryStore());
    const plan = await runtime.planTeam({}, 'Fallback', 'en', { businessId: 'business-1' });
    expect(plan.objective).toBe('Fallback');
  });
});
