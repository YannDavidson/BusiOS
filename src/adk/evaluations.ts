import type { AgentId } from '../agents/types.js';
import type { SpecialistResult, WorkPlan } from '../team-runtime.js';
import type { AdkInvocationContext, AdkInvocationMetrics } from './types.js';

export interface EvaluationBudget {
  maxLatencyMs: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

export function evaluatePlan(plan: WorkPlan, pilotAgents: ReadonlySet<AgentId>) {
  const invalidRoutes = plan.assignments.filter((assignment) => assignment.agent === 'DIEGO' || !pilotAgents.has(assignment.agent));
  return { passed: invalidRoutes.length === 0, invalidRoutes: invalidRoutes.map((assignment) => assignment.agent) };
}

export function evaluateSpecialistResult(result: SpecialistResult) {
  return {
    passed: result.summary.trim().length >= 3 && result.confidence >= 0 && result.confidence <= 1 && result.executionReady === false,
    hasFindings: result.findings.length > 0,
    draftOnly: result.executionReady === false
  };
}

export function buildMetrics(input: {
  context: AdkInvocationContext;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  qualityPassed: boolean;
  budget: EvaluationBudget;
}): AdkInvocationMetrics {
  const estimatedCost = (input.inputTokens * input.budget.inputCostPerMillion + input.outputTokens * input.budget.outputCostPerMillion) / 1_000_000;
  return {
    operation: input.context.operation,
    agent: input.context.agent,
    durationMs: input.durationMs,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedCostMicros: Math.round(estimatedCost * 1_000_000),
    passedLatency: input.durationMs <= input.budget.maxLatencyMs,
    passedQuality: input.qualityPassed
  };
}
