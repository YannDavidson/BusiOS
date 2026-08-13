import { randomUUID } from 'node:crypto';
import type { IntelligenceEngine } from './diego.js';
import { onboardingComplete, question, recordAnswer } from './onboarding.js';
import { detectLanguage, isConversationControl, requestedLanguage, type SupportedLanguage } from './language.js';
import type { Store } from './store.js';

export class Orchestrator {
  constructor(private store: Store, private diego: IntelligenceEngine) {}

  async handle(phone: string, body: string): Promise<string> {
    let state = await this.store.get(phone);
    if (!state) {
      const language = detectLanguage(body, body) ?? 'en';
      state = { businessId: randomUUID(), phone, language, onboardingStep: 0, brain: {} };
      await this.store.put(state);
      return `${copy(language).welcome}\n\n1/10 — ${question(language, 0)}`;
    }
    const normalized = body.trim().toLowerCase();
    const explicitLanguage = requestedLanguage(body);
    const detectedLanguage = detectLanguage(body);
    if (explicitLanguage || (detectedLanguage && detectedLanguage !== state.language)) {
      state.language = explicitLanguage ?? detectedLanguage ?? state.language;
      await this.store.put(state);
      if (explicitLanguage) return `${copy(state.language).languageChanged}\n\n${currentQuestion(state.language, state.onboardingStep)}`;
    }
    if (isConversationControl(body) && !onboardingComplete(state.onboardingStep)) {
      return `${copy(state.language).present}\n\n${currentQuestion(state.language, state.onboardingStep)}`;
    }
    if (state.pendingOpportunity && ['approve', 'approve & execute', 'aprobar', 'aprobar y ejecutar', 'aprovar', 'aprovar e executar', '1'].includes(normalized)) {
      await this.store.audit(state.businessId, 'opportunity.approved', state.pendingOpportunity);
      const targets = state.pendingOpportunity.execution_payload.target_agents.join(', ');
      state.pendingOpportunity = undefined;
      await this.store.put(state);
      return copy(state.language).approved(targets);
    }
    if (!onboardingComplete(state.onboardingStep)) {
      state.brain = recordAnswer(state.brain, state.onboardingStep, body);
      state.onboardingStep += 1;
      await this.store.put(state);
      if (!onboardingComplete(state.onboardingStep)) return currentQuestion(state.language, state.onboardingStep);
      await this.store.audit(state.businessId, 'onboarding.completed', { fields: Object.keys(state.brain) });
      return copy(state.language).complete;
    }
    const signalPrefix = ['signals:', 'señales:', 'sinais:'].find((prefix) => normalized.startsWith(prefix));
    if (signalPrefix) {
      const opportunity = await this.diego.detectOpportunity(state.brain, body.slice(signalPrefix.length), state.language);
      state.pendingOpportunity = opportunity;
      await this.store.put(state);
      await this.store.audit(state.businessId, 'opportunity.proposed', opportunity);
      const labels = copy(state.language);
      return `📈 *${opportunity.insight_title}*\n\n${opportunity.observation}\n\n*${labels.recommendation}:* ${opportunity.recommendation}\n*${labels.impact}:* ${opportunity.predicted_impact}\n*${labels.confidence}:* ${Math.round(opportunity.confidence_score * 100)}%\n\n${labels.approve}`;
    }
    return this.diego.respond(state.brain, body, state.language);
  }
}

function currentQuestion(language: SupportedLanguage, step: number) {
  return `${step + 1}/10 — ${question(language, step)}`;
}

function copy(language: SupportedLanguage) {
  const values = {
    en: { welcome: "Welcome to BusiOS AI. I'm Diego, your AI business intelligence partner. Answer naturally—in a few words or as much detail as you like—to seed your Business Brain.", present: "I'm here. Your answer was not recorded, so we can continue safely.", languageChanged: 'Language changed to English.', complete: 'Your Business Brain is ready. Tell me what happened today, paste business signals, or ask what deserves your attention first.', recommendation: 'Recommendation', impact: 'Predicted impact', confidence: 'Confidence', approve: 'Reply *APPROVE* to authorize the plan or tell me what to change.', approved: (agents: string) => `Approved. I recorded the plan for ${agents}. External actions remain in safe simulation mode until each integration is verified.` },
    es: { welcome: 'Bienvenido a BusiOS AI. Soy Diego, tu socio de inteligencia empresarial. Responde de forma natural—con unas palabras o con todos los detalles que desees—para crear el Cerebro de tu Negocio.', present: 'Aquí estoy. Tu mensaje no fue registrado como respuesta, así que podemos continuar con seguridad.', languageChanged: 'Idioma cambiado a español.', complete: 'El Cerebro de tu Negocio está listo. Cuéntame qué ocurrió hoy, comparte señales del negocio o pregúntame qué merece atención primero.', recommendation: 'Recomendación', impact: 'Impacto previsto', confidence: 'Confianza', approve: 'Responde *APPROVE* para autorizar el plan o dime qué deseas cambiar.', approved: (agents: string) => `Aprobado. Registré el plan para ${agents}. Las acciones externas permanecen en simulación segura hasta verificar cada integración.` },
    pt: { welcome: 'Bem-vindo ao BusiOS AI. Sou Diego, seu parceiro de inteligência empresarial. Responda naturalmente—com poucas palavras ou com todos os detalhes que desejar—para criar o Cérebro do seu Negócio.', present: 'Estou aqui. Sua mensagem não foi registrada como resposta, então podemos continuar com segurança.', languageChanged: 'Idioma alterado para português.', complete: 'O Cérebro do seu Negócio está pronto. Conte o que aconteceu hoje, envie sinais da empresa ou pergunte o que merece atenção primeiro.', recommendation: 'Recomendação', impact: 'Impacto previsto', confidence: 'Confiança', approve: 'Responda *APPROVE* para autorizar o plano ou diga o que deseja alterar.', approved: (agents: string) => `Aprovado. Registrei o plano para ${agents}. As ações externas permanecem em simulação segura até que cada integração seja verificada.` }
  };
  return values[language];
}
