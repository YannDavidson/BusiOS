import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import type { ConversationState } from './domain.js';
import type { AgentTask, RunStatus, SpecialistResult, TaskStatus, TeamRun } from './team-runtime.js';

export interface Store {
  get(phone: string): Promise<ConversationState | null>;
  put(state: ConversationState): Promise<void>;
  audit(businessId: string, eventType: string, payload: unknown): Promise<void>;
  createTeamRun(run: TeamRun, tasks: AgentTask[]): Promise<void>;
  getTeamRun(runId: string): Promise<TeamRun | null>;
  getLatestTeamRun(businessId: string): Promise<TeamRun | null>;
  getRunTasks(runId: string): Promise<AgentTask[]>;
  updateTeamRun(runId: string, status: RunStatus, synthesis?: string): Promise<void>;
  updateAgentTask(taskId: string, status: TaskStatus, result?: SpecialistResult): Promise<void>;
}

export class MemoryStore implements Store {
  private states = new Map<string, ConversationState>();
  private runs = new Map<string, TeamRun>();
  private tasks = new Map<string, AgentTask>();
  async get(phone: string) { return this.states.get(phone) ?? null; }
  async put(state: ConversationState) { this.states.set(state.phone, structuredClone(state)); }
  async audit() { return; }
  async createTeamRun(run: TeamRun, tasks: AgentTask[]) { this.runs.set(run.id, structuredClone(run)); for (const task of tasks) this.tasks.set(task.id, structuredClone(task)); }
  async getTeamRun(runId: string) { return structuredClone(this.runs.get(runId) ?? null); }
  async getLatestTeamRun(businessId: string) { return structuredClone([...this.runs.values()].filter((run) => run.businessId === businessId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null); }
  async getRunTasks(runId: string) { return structuredClone([...this.tasks.values()].filter((task) => task.runId === runId)); }
  async updateTeamRun(runId: string, status: RunStatus, synthesis?: string) { const run = this.runs.get(runId); if (!run) throw new Error('Team run not found'); this.runs.set(runId, { ...run, status, synthesis: synthesis ?? run.synthesis, updatedAt: new Date().toISOString() }); }
  async updateAgentTask(taskId: string, status: TaskStatus, result?: SpecialistResult) { const task = this.tasks.get(taskId); if (!task) throw new Error('Agent task not found'); this.tasks.set(taskId, { ...task, status, result: result ?? task.result, updatedAt: new Date().toISOString() }); }
}

export class SupabaseStore implements Store {
  constructor(private client: SupabaseClient) {}
  async get(phone: string) {
    const { data, error } = await this.client.from('conversation_states').select('*').eq('phone', phone).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { businessId: data.business_id, phone: data.phone, language: data.language ?? 'en', onboardingStep: data.onboarding_step, brain: data.brain, pendingOpportunity: data.pending_opportunity ?? undefined, pendingRunId: data.pending_run_id ?? undefined };
  }
  async put(state: ConversationState) {
    const { error } = await this.client.from('conversation_states').upsert({
      business_id: state.businessId, phone: state.phone, language: state.language, onboarding_step: state.onboardingStep,
      brain: state.brain, pending_opportunity: state.pendingOpportunity ?? null, pending_run_id: state.pendingRunId ?? null, updated_at: new Date().toISOString()
    }, { onConflict: 'phone' });
    if (error) throw error;
  }
  async audit(businessId: string, eventType: string, payload: unknown) {
    const { error } = await this.client.from('audit_events').insert({ business_id: businessId, event_type: eventType, payload });
    if (error) throw error;
  }
  async createTeamRun(run: TeamRun, tasks: AgentTask[]) {
    const { error: runError } = await this.client.from('team_runs').insert(toRunRow(run));
    if (runError) throw runError;
    const { error: taskError } = await this.client.from('agent_tasks').insert(tasks.map(toTaskRow));
    if (taskError) throw taskError;
  }
  async getTeamRun(runId: string) { const { data, error } = await this.client.from('team_runs').select('*').eq('id', runId).maybeSingle(); if (error) throw error; return data ? fromRunRow(data) : null; }
  async getLatestTeamRun(businessId: string) { const { data, error } = await this.client.from('team_runs').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(1).maybeSingle(); if (error) throw error; return data ? fromRunRow(data) : null; }
  async getRunTasks(runId: string) { const { data, error } = await this.client.from('agent_tasks').select('*').eq('run_id', runId).order('created_at'); if (error) throw error; return (data ?? []).map(fromTaskRow); }
  async updateTeamRun(runId: string, status: RunStatus, synthesis?: string) { const values: Record<string, unknown> = { status, updated_at: new Date().toISOString() }; if (synthesis !== undefined) values.synthesis = synthesis; const { error } = await this.client.from('team_runs').update(values).eq('id', runId); if (error) throw error; }
  async updateAgentTask(taskId: string, status: TaskStatus, result?: SpecialistResult) { const values: Record<string, unknown> = { status, updated_at: new Date().toISOString() }; if (result !== undefined) values.result = result; const { error } = await this.client.from('agent_tasks').update(values).eq('id', taskId); if (error) throw error; }
}

function toRunRow(run: TeamRun) { return { id: run.id, business_id: run.businessId, objective: run.objective, status: run.status, language: run.language, plan: run.plan, synthesis: run.synthesis ?? null, created_at: run.createdAt, updated_at: run.updatedAt }; }
function fromRunRow(data: Record<string, any>): TeamRun { return { id: data.id, businessId: data.business_id, objective: data.objective, status: data.status, language: data.language, plan: data.plan, synthesis: data.synthesis ?? undefined, createdAt: data.created_at, updatedAt: data.updated_at }; }
function toTaskRow(task: AgentTask) { return { id: task.id, run_id: task.runId, business_id: task.businessId, agent_id: task.assignment.agent, objective: task.assignment.objective, risk: task.assignment.risk, requires_owner_approval: task.assignment.requiresOwnerApproval, status: task.status, result: task.result ?? null, created_at: task.createdAt, updated_at: task.updatedAt }; }
function fromTaskRow(data: Record<string, any>): AgentTask { return { id: data.id, runId: data.run_id, businessId: data.business_id, assignment: { agent: data.agent_id, objective: data.objective, risk: data.risk, requiresOwnerApproval: data.requires_owner_approval }, status: data.status, result: data.result ?? undefined, createdAt: data.created_at, updatedAt: data.updated_at }; }

export function createStore(): Store {
  if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseStore(createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
  }
  if (config.NODE_ENV === 'production') throw new Error('Persistent store required in production');
  return new MemoryStore();
}
