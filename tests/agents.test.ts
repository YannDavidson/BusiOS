import { describe, expect, it } from 'vitest';
import { agentRegistry, buildTeamSystemPrompt, getAgent, listAgents } from '../src/agents/registry.js';
import { agentIds } from '../src/agents/types.js';

describe('agent persona registry', () => {
  it('contains one complete persona for every BusiOS agent', () => {
    expect(listAgents()).toHaveLength(8);
    expect(Object.keys(agentRegistry).sort()).toEqual([...agentIds].sort());
    for (const agent of listAgents()) {
      expect(agent.mission.length).toBeGreaterThan(30);
      expect(agent.responsibilities.length).toBeGreaterThanOrEqual(4);
      expect(agent.inputs.length).toBeGreaterThanOrEqual(4);
      expect(agent.outputs.length).toBeGreaterThanOrEqual(4);
      expect(agent.guardrails.length).toBeGreaterThanOrEqual(6);
      expect(agent.languages).toEqual(['en', 'es', 'pt']);
    }
  });

  it('makes Diego CIO and every specialist accountable to him', () => {
    expect(getAgent('DIEGO').title).toBe('Chief Intelligence Officer');
    expect(getAgent('DIEGO').reportsTo).toBeNull();
    for (const id of agentIds.filter((id) => id !== 'DIEGO')) {
      expect(getAgent(id).reportsTo).toBe('DIEGO');
      expect(getAgent('DIEGO').collaboratesWith).toContain(id);
    }
  });

  it('injects the complete team and verified-execution rule into Diego prompt context', () => {
    const prompt = buildTeamSystemPrompt();
    for (const id of agentIds) expect(prompt).toContain(id);
    expect(prompt).toContain('never report execution without a verified result');
  });
});
