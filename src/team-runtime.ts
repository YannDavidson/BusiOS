import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { agentIds, type AgentId, type AgentAssignment, type ActionRisk } from './agents/types.js';
import { getAgent } from './agents/registry.js';
import type { BusinessBrain } from './domain.js';
import type { SupportedLanguage } from './language.js';
import type { Store } from './store.js';
import { withLiveKnowledge, type KnowledgeRetriever } from './knowledge/context.js';

export const runStatuses = ['planned', 'awaiting_approval', 'running', 'completed', 'cancelled', 'failed'] as const;
export type RunStatus = (typeof runStatuses)[number];
export const taskStatuses = ['planned', 'running', 'completed', 'cancelled', 'failed'] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const workPlanSchema = z.object({
  objective: z.string().min(3),
  rationale: z.string().min(10),
  assignments: z.array(z.object({
    agent: z.enum(agentIds), objective: z.string().min(5),
    risk: z.enum(['informational', 'reversible', 'consequential', 'restricted']),
    requiresOwnerApproval: z.boolean()
  })).min(1),
  conflictsToResolve: z.array(z.string()),
  requiresOwnerApproval: z.boolean()
});

export const specialistResultSchema = z.object({
  summary: z.string().min(3),
  findings: z.array(z.string()),
  proposedActions: z.array(z.string()),
  assumptions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  executionReady: z.boolean()
});

export type WorkPlan = z.infer<typeof workPlanSchema>;
export type SpecialistResult = z.infer<typeof specialistResultSchema>;

export interface TeamRun {
  id: string; businessId: string; objective: string; status: RunStatus;
  language: SupportedLanguage; plan: WorkPlan; synthesis?: string;
  createdAt: string; updatedAt: string;
}

export interface AgentTask {
  id: string; runId: string; businessId: string; assignment: AgentAssignment;
  status: TaskStatus; result?: SpecialistResult; createdAt: string; updatedAt: string;
}

export interface TeamIntelligence {
  planTeam(brain: BusinessBrain, objective: string, language: SupportedLanguage): Promise<WorkPlan>;
  runSpecialist(agent: AgentId, brain: BusinessBrain, assignment: AgentAssignment, language: SupportedLanguage): Promise<SpecialistResult>;
  synthesizeTeam(brain: BusinessBrain, plan: WorkPlan, results: Array<{ agent: AgentId; result: SpecialistResult }>, language: SupportedLanguage): Promise<string>;
}

export class MultiAgentRuntime {
  constructor(private store: Store, private intelligence: TeamIntelligence, private knowledge?: KnowledgeRetriever) {}

  async plan(businessId: string, brain: BusinessBrain, objective: string, language: SupportedLanguage): Promise<TeamRun> {
    const enriched = await withLiveKnowledge(brain, this.knowledge, businessId, 'DIEGO', objective);
    const plan = workPlanSchema.parse(await this.intelligence.planTeam(enriched, objective, language));
    const requiresApproval = plan.requiresOwnerApproval || plan.assignments.some((item) => item.requiresOwnerApproval || item.risk !== 'informational');
    const now = new Date().toISOString();
    const run: TeamRun = { id: randomUUID(), businessId, objective, language, plan: { ...plan, requiresOwnerApproval: requiresApproval }, status: requiresApproval ? 'awaiting_approval' : 'planned', createdAt: now, updatedAt: now };
    const tasks: AgentTask[] = plan.assignments.map((assignment) => ({ id: randomUUID(), runId: run.id, businessId, assignment, status: 'planned', createdAt: now, updatedAt: now }));
    await this.store.createTeamRun(run, tasks);
    await this.store.audit(businessId, 'team.run.planned', { runId: run.id, plan: run.plan });
    return run;
  }

  async execute(run: TeamRun, brain: BusinessBrain): Promise<TeamRun> {
    if (run.status !== 'awaiting_approval' && run.status !== 'planned') throw new Error(`Run ${run.id} cannot execute from ${run.status}`);
    await this.store.updateTeamRun(run.id, 'running');
    const tasks = await this.store.getRunTasks(run.id);
    const results: Array<{ agent: AgentId; result: SpecialistResult }> = [];
    try {
      for (const task of tasks) {
        await this.store.updateAgentTask(task.id, 'running');
        const enriched = await withLiveKnowledge(brain, this.knowledge, run.businessId, task.assignment.agent, task.assignment.objective);
        const result = specialistResultSchema.parse(await this.intelligence.runSpecialist(task.assignment.agent, enriched, task.assignment, run.language));
        // Until a verified adapter records an execution receipt, agents may analyze and draft only.
        result.executionReady = false;
        await this.store.updateAgentTask(task.id, 'completed', result);
        results.push({ agent: task.assignment.agent, result });
      }
      const synthesisBrain = await withLiveKnowledge(brain, this.knowledge, run.businessId, 'DIEGO', run.objective);
      const synthesis = await this.intelligence.synthesizeTeam(synthesisBrain, run.plan, results, run.language);
      await this.store.updateTeamRun(run.id, 'completed', synthesis);
      await this.store.audit(run.businessId, 'team.run.completed', { runId: run.id, results, synthesis });
      return { ...run, status: 'completed', synthesis, updatedAt: new Date().toISOString() };
    } catch (error) {
      await this.store.updateTeamRun(run.id, 'failed', error instanceof Error ? error.message : 'Unknown failure');
      await this.store.audit(run.businessId, 'team.run.failed', { runId: run.id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async ask(businessId: string, brain: BusinessBrain, agent: AgentId, objective: string, language: SupportedLanguage): Promise<SpecialistResult> {
    if (agent === 'DIEGO') throw new Error('Ask Diego directly without specialist routing.');
    const assignment: AgentAssignment = { agent, objective, risk: 'informational', requiresOwnerApproval: false };
    const now = new Date().toISOString();
    const plan: WorkPlan = { objective, rationale: `Direct informational request for ${getAgent(agent).title}.`, assignments: [assignment], conflictsToResolve: [], requiresOwnerApproval: false };
    const run: TeamRun = { id: randomUUID(), businessId, objective, language, plan, status: 'running', createdAt: now, updatedAt: now };
    const task: AgentTask = { id: randomUUID(), runId: run.id, businessId, assignment, status: 'running', createdAt: now, updatedAt: now };
    await this.store.createTeamRun(run, [task]);
    const enriched = await withLiveKnowledge(brain, this.knowledge, businessId, agent, objective);
    const result = specialistResultSchema.parse(await this.intelligence.runSpecialist(agent, enriched, assignment, language));
    result.executionReady = false;
    await this.store.updateAgentTask(task.id, 'completed', result);
    await this.store.updateTeamRun(run.id, 'completed', result.summary);
    await this.store.audit(businessId, 'agent.asked', { runId: run.id, agent, objective, result });
    return result;
  }
}

export function riskNeedsApproval(risk: ActionRisk) {
  return risk !== 'informational';
}
