import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { opportunitySchema, type BusinessBrain, type Opportunity } from './domain.js';
import type { SupportedLanguage } from './language.js';
import { buildTeamSystemPrompt, getAgent } from './agents/registry.js';
import type { AgentId, AgentAssignment } from './agents/types.js';
import { specialistResultSchema, workPlanSchema, type SpecialistResult, type TeamIntelligence, type WorkPlan } from './team-runtime.js';

export interface IntelligenceEngine {
  respond(brain: BusinessBrain, message: string, language: SupportedLanguage): Promise<string>;
  detectOpportunity(brain: BusinessBrain, signals: string, language: SupportedLanguage): Promise<Opportunity>;
}

const diego = getAgent('DIEGO');
const guardrails = `You are ${diego.name}, the owner-facing ${diego.title} for BusiOS.
Mission: ${diego.mission}
Voice: ${diego.voice.join('; ')}.
Guardrails: ${diego.guardrails.join('; ')}.
${buildTeamSystemPrompt()}`;

export class GeminiDiego implements IntelligenceEngine, TeamIntelligence {
  private ai: GoogleGenAI;
  constructor(apiKey = config.GEMINI_API_KEY) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    this.ai = new GoogleGenAI({ apiKey });
  }
  async respond(brain: BusinessBrain, message: string, language: SupportedLanguage) {
    const result = await this.ai.models.generateContent({ model: config.GEMINI_MODEL, contents: `${guardrails}\nAlways respond in ${language === 'es' ? 'Spanish' : language === 'pt' ? 'Portuguese' : 'English'}.\nBUSINESS BRAIN:\n${JSON.stringify(brain)}\nOWNER MESSAGE:\n${message}` });
    return result.text ?? 'I could not generate a response. Please try again.';
  }
  async detectOpportunity(brain: BusinessBrain, signals: string, language: SupportedLanguage) {
    const result = await this.ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: `${guardrails}\nWrite all human-readable JSON values in ${language === 'es' ? 'Spanish' : language === 'pt' ? 'Portuguese' : 'English'}. Analyze cross-functional signals. Return one evidence-linked opportunity. Approval must be true.\nBUSINESS BRAIN:${JSON.stringify(brain)}\nSIGNALS:${signals}`,
      config: { responseMimeType: 'application/json', responseJsonSchema: opportunitySchema.toJSONSchema() }
    });
    return opportunitySchema.parse(JSON.parse(result.text ?? '{}'));
  }
  async planTeam(brain: BusinessBrain, objective: string, language: SupportedLanguage): Promise<WorkPlan> {
    const result = await this.ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: `${guardrails}\nCreate the smallest effective multi-agent plan for the owner's objective. Use DIEGO only for synthesis, not as a specialist assignment. Consequential, reversible, or restricted work requires owner approval. Return JSON in ${languageName(language)}.\nBUSINESS BRAIN:${JSON.stringify(brain)}\nOBJECTIVE:${objective}`,
      config: { responseMimeType: 'application/json', responseJsonSchema: workPlanSchema.toJSONSchema() }
    });
    return workPlanSchema.parse(JSON.parse(result.text ?? '{}'));
  }
  async runSpecialist(agentId: AgentId, brain: BusinessBrain, assignment: AgentAssignment, language: SupportedLanguage): Promise<SpecialistResult> {
    const agent = getAgent(agentId);
    const result = await this.ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: `You are ${agent.name}, ${agent.title}. Mission: ${agent.mission}\nVoice:${agent.voice.join('; ')}\nResponsibilities:${agent.responsibilities.join('; ')}\nGuardrails:${agent.guardrails.join('; ')}\nAnalyze or draft only. Do not claim external execution. Respond in ${languageName(language)} as structured JSON.\nBUSINESS BRAIN:${JSON.stringify(brain)}\nASSIGNMENT:${JSON.stringify(assignment)}`,
      config: { responseMimeType: 'application/json', responseJsonSchema: specialistResultSchema.toJSONSchema() }
    });
    return specialistResultSchema.parse(JSON.parse(result.text ?? '{}'));
  }
  async synthesizeTeam(brain: BusinessBrain, plan: WorkPlan, results: Array<{ agent: AgentId; result: SpecialistResult }>, language: SupportedLanguage): Promise<string> {
    const result = await this.ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: `${guardrails}\nSynthesize the specialist findings into one concise executive response. Attribute important findings, reconcile conflicts, state assumptions and confidence, and distinguish drafts from executed actions. Respond in ${languageName(language)}.\nBUSINESS BRAIN:${JSON.stringify(brain)}\nPLAN:${JSON.stringify(plan)}\nRESULTS:${JSON.stringify(results)}`
    });
    return result.text ?? 'The team completed its analysis, but I could not generate the final synthesis.';
  }
}

function languageName(language: SupportedLanguage) {
  return language === 'es' ? 'Spanish' : language === 'pt' ? 'Portuguese' : 'English';
}
