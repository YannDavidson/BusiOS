import type { AgentId } from '../agents/types.js';

export interface AdkInvocationContext {
  businessId: string;
  runId?: string;
  taskId?: string;
  operation: 'plan' | 'specialist' | 'synthesis';
  agent: AgentId;
}

export interface AdkInvocationMetrics {
  operation: AdkInvocationContext['operation'];
  agent: AgentId;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
  passedLatency: boolean;
  passedQuality: boolean;
}
