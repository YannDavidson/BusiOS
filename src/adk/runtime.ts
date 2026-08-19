import { InMemoryRunner, isFinalResponse, stringifyContent } from '@google/adk';
import type { AgentId, AgentAssignment } from '../agents/types.js';
import type { BusinessBrain } from '../domain.js';
import type { SupportedLanguage } from '../language.js';
import type { Store } from '../store.js';
import { specialistResultSchema, workPlanSchema, type SpecialistResult, type TeamIntelligence, type TeamIntelligenceContext, type WorkPlan } from '../team-runtime.js';
import type { VerifiedActionService } from '../actions/service.js';
import { config } from '../config.js';
import { buildMetrics, evaluatePlan, evaluateSpecialistResult, type EvaluationBudget } from './evaluations.js';
import { buildAdkAgentTeam, parsePilotAgents } from './personas.js';
import type { AdkInvocationContext } from './types.js';

const languageName = (language: SupportedLanguage) => language === 'es' ? 'Spanish' : language === 'pt' ? 'Portuguese' : 'English';

export class AdkTeamIntelligence implements TeamIntelligence {
  readonly team;
  private budget: EvaluationBudget;

  constructor(private store: Store, actionService: VerifiedActionService, options: {
    model?: string;
    pilotAgents?: ReadonlySet<AgentId>;
    budget?: Partial<EvaluationBudget>;
    apiKey?: string;
  } = {}) {
    const apiKey = options.apiKey ?? config.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is required for the ADK runtime');
    process.env.GOOGLE_API_KEY ??= apiKey;
    const pilotAgents = options.pilotAgents ?? parsePilotAgents(config.ADK_PILOT_AGENTS);
    this.team = buildAdkAgentTeam({ model: options.model ?? config.GEMINI_MODEL, pilotAgents, actionService });
    this.budget = {
      maxLatencyMs: options.budget?.maxLatencyMs ?? config.ADK_MAX_LATENCY_MS,
      inputCostPerMillion: options.budget?.inputCostPerMillion ?? config.ADK_INPUT_COST_PER_MILLION,
      outputCostPerMillion: options.budget?.outputCostPerMillion ?? config.ADK_OUTPUT_COST_PER_MILLION
    };
  }

  async planTeam(brain: BusinessBrain, objective: string, language: SupportedLanguage, runtime?: TeamIntelligenceContext): Promise<WorkPlan> {
    const context = this.context(runtime, 'plan', 'DIEGO');
    const invocation = await this.invoke(this.team.root, context, `Create the smallest effective plan using only these enabled specialists: ${[...this.team.pilotAgents].join(', ')}. Use DIEGO only for synthesis. Return JSON only. Human-readable values must be in ${languageName(language)}.\nBUSINESS BRAIN:${JSON.stringify(brain)}\nOBJECTIVE:${objective}`);
    const plan = workPlanSchema.parse(JSON.parse(invocation.text));
    const evaluation = evaluatePlan(plan, this.team.pilotAgents);
    await this.record(invocation, evaluation.passed);
    if (!evaluation.passed) throw new Error(`ADK produced routes outside the pilot: ${evaluation.invalidRoutes.join(', ')}`);
    return plan;
  }

  async runSpecialist(agentId: AgentId, brain: BusinessBrain, assignment: AgentAssignment, language: SupportedLanguage, runtime?: TeamIntelligenceContext): Promise<SpecialistResult> {
    if (!this.team.pilotAgents.has(agentId)) throw new Error(`${agentId} is not enabled in the ADK pilot`);
    const context = this.context(runtime, 'specialist', agentId);
    const agent = this.team.agents.get(agentId)!.clone({ subAgents: [] });
    const invocation = await this.invoke(agent, context, `Complete this assignment using only supplied tenant data. Analyze or draft; never claim execution. Set executionReady to false. Return JSON only in ${languageName(language)}.\nBUSINESS BRAIN:${JSON.stringify(brain)}\nASSIGNMENT:${JSON.stringify(assignment)}`);
    const result = specialistResultSchema.parse(JSON.parse(invocation.text));
    result.executionReady = false;
    const evaluation = evaluateSpecialistResult(result);
    await this.record(invocation, evaluation.passed);
    return result;
  }

  async synthesizeTeam(brain: BusinessBrain, plan: WorkPlan, results: Array<{ agent: AgentId; result: SpecialistResult }>, language: SupportedLanguage, runtime?: TeamIntelligenceContext): Promise<string> {
    const context = this.context(runtime, 'synthesis', 'DIEGO');
    const invocation = await this.invoke(this.team.root, context, `Synthesize one concise executive recommendation. Attribute important findings, reconcile conflicts, preserve citations, state assumptions and confidence, and distinguish proposals from verified execution. Respond in ${languageName(language)}.\nBUSINESS BRAIN:${JSON.stringify(brain)}\nPLAN:${JSON.stringify(plan)}\nRESULTS:${JSON.stringify(results)}`);
    await this.record(invocation, invocation.text.trim().length > 20);
    return invocation.text;
  }

  private context(runtime: TeamIntelligenceContext | undefined, operation: AdkInvocationContext['operation'], agent: AgentId): AdkInvocationContext {
    if (!runtime?.businessId) throw new Error('ADK invocation requires a businessId');
    return { businessId: runtime.businessId, runId: runtime.runId, taskId: runtime.taskId, operation, agent };
  }

  private async invoke(agent: typeof this.team.root, context: AdkInvocationContext, prompt: string) {
    const started = Date.now();
    const runner = new InMemoryRunner({ appName: 'busios-adk-pilot', agent });
    let response = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const event of runner.runEphemeral({
      userId: context.businessId,
      stateDelta: { businessId: context.businessId, runId: context.runId ?? '', taskId: context.taskId ?? '', tenantIsolationRequired: true },
      newMessage: { role: 'user', parts: [{ text: prompt }] }
    })) {
      const usage = event.usageMetadata;
      inputTokens += usage?.promptTokenCount ?? 0;
      outputTokens += usage?.candidatesTokenCount ?? 0;
      if (isFinalResponse(event)) response = stringifyContent(event);
    }
    if (!response.trim()) throw new Error('ADK returned no final response');
    return { context, text: stripJsonFence(response.trim()), durationMs: Date.now() - started, inputTokens, outputTokens };
  }

  private async record(invocation: { context: AdkInvocationContext; durationMs: number; inputTokens: number; outputTokens: number }, qualityPassed: boolean) {
    const context = invocation.context;
    const metrics = buildMetrics({ ...invocation, qualityPassed, budget: this.budget });
    await this.store.audit(context.businessId, 'adk.evaluation.completed', { ...metrics, runId: context.runId, taskId: context.taskId });
  }
}

export class FailoverTeamIntelligence implements TeamIntelligence {
  constructor(private primary: TeamIntelligence, private fallback: TeamIntelligence, private store: Store) {}
  planTeam(...args: Parameters<TeamIntelligence['planTeam']>) { return this.call('planTeam', args); }
  runSpecialist(...args: Parameters<TeamIntelligence['runSpecialist']>) { return this.call('runSpecialist', args); }
  synthesizeTeam(...args: Parameters<TeamIntelligence['synthesizeTeam']>) { return this.call('synthesizeTeam', args); }
  private async call<K extends keyof TeamIntelligence>(method: K, args: Parameters<TeamIntelligence[K]>): Promise<Awaited<ReturnType<TeamIntelligence[K]>>> {
    try {
      return await (this.primary[method] as (...values: Parameters<TeamIntelligence[K]>) => ReturnType<TeamIntelligence[K]>)(...args);
    } catch (error) {
      const runtime = args.at(-1) as TeamIntelligenceContext | undefined;
      if (runtime?.businessId) await this.store.audit(runtime.businessId, 'adk.fallback.activated', { method, error: error instanceof Error ? error.message : String(error) });
      return await (this.fallback[method] as (...values: Parameters<TeamIntelligence[K]>) => ReturnType<TeamIntelligence[K]>)(...args);
    }
  }
}

function stripJsonFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}
