import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { opportunitySchema, type BusinessBrain, type Opportunity } from './domain.js';
import type { SupportedLanguage } from './language.js';
import { buildTeamSystemPrompt, getAgent } from './agents/registry.js';

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

export class GeminiDiego implements IntelligenceEngine {
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
}
