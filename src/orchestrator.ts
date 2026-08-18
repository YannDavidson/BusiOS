import { randomUUID } from 'node:crypto';
import type { IntelligenceEngine } from './diego.js';
import { onboardingComplete, question, recordAnswer } from './onboarding.js';
import { detectLanguage, isConversationControl, requestedLanguage, type SupportedLanguage } from './language.js';
import type { Store } from './store.js';
import { agentIds, type AgentId } from './agents/types.js';
import { getAgent, listAgents } from './agents/registry.js';
import type { MultiAgentRuntime } from './team-runtime.js';
import { withLiveKnowledge, type KnowledgeRetriever } from './knowledge/context.js';

export class Orchestrator {
  constructor(private store: Store, private diego: IntelligenceEngine, private team?: MultiAgentRuntime, private knowledge?: KnowledgeRetriever) {}

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
    if (isCommand(normalized, ['team', 'equipo', 'equipe'])) {
      return listAgents().map((agent) => `${agent.id === 'DIEGO' ? '👑' : '•'} *${agent.name}* — ${agent.title}`).join('\n');
    }
    if (isCommand(normalized, ['memory', 'memoria', 'memória'])) {
      const entries = Object.entries(state.brain);
      return entries.length ? entries.map(([key, value]) => `*${key}:* ${value}`).join('\n') : copy(state.language).emptyMemory;
    }
    if (normalized.startsWith('correct ') || normalized.startsWith('corregir ') || normalized.startsWith('corrigir ')) {
      const correction = body.slice(body.indexOf(' ') + 1);
      const [rawField, ...parts] = correction.split('=');
      const field = rawField?.trim() as keyof typeof state.brain;
      const value = parts.join('=').trim();
      if (!field || !value || !Object.hasOwn(state.brain, field)) return copy(state.language).correctionHelp;
      state.brain[field] = value;
      await this.store.put(state);
      await this.store.audit(state.businessId, 'business_brain.corrected', { field, value });
      return copy(state.language).corrected(field);
    }
    if (isCommand(normalized, ['status', 'estado'])) {
      const run = state.pendingRunId
        ? await this.store.getTeamRun(state.pendingRunId)
        : await this.store.getLatestTeamRun(state.businessId);
      if (!run) return copy(state.language).noRuns;
      const tasks = await this.store.getRunTasks(run.id);
      return `*${run.status.toUpperCase()}* — ${run.objective}\n${tasks.map((task) => `• ${getAgent(task.assignment.agent).name}: ${task.status}`).join('\n')}${run.synthesis ? `\n\n${run.synthesis}` : ''}`;
    }
    if (isCommand(normalized, ['cancel', 'cancelar'])) {
      if (!state.pendingRunId) return copy(state.language).nothingToCancel;
      await this.store.updateTeamRun(state.pendingRunId, 'cancelled');
      await this.store.audit(state.businessId, 'team.run.cancelled', { runId: state.pendingRunId });
      state.pendingRunId = undefined;
      await this.store.put(state);
      return copy(state.language).cancelled;
    }
    if (state.pendingRunId && ['approve', 'approve & execute', 'aprobar', 'aprobar y ejecutar', 'aprovar', 'aprovar e executar', '1'].includes(normalized)) {
      if (!this.team) return copy(state.language).teamUnavailable;
      const run = await this.store.getTeamRun(state.pendingRunId);
      if (!run) { state.pendingRunId = undefined; await this.store.put(state); return copy(state.language).noRuns; }
      const result = await this.team.execute(run, state.brain);
      state.pendingRunId = undefined;
      await this.store.put(state);
      return result.synthesis ?? copy(state.language).teamCompleted;
    }
    const ask = parseAsk(body);
    if (ask) {
      if (!this.team) return copy(state.language).teamUnavailable;
      const result = await this.team.ask(state.businessId, state.brain, ask.agent, ask.objective, state.language);
      return `*${getAgent(ask.agent).name}:* ${result.summary}\n\n${result.findings.map((finding) => `• ${finding}`).join('\n')}`;
    }
    const planObjective = parsePlan(body);
    if (planObjective) {
      if (!this.team) return copy(state.language).teamUnavailable;
      const run = await this.team.plan(state.businessId, state.brain, planObjective, state.language);
      state.pendingRunId = run.status === 'awaiting_approval' ? run.id : undefined;
      await this.store.put(state);
      const assignments = run.plan.assignments.map((item) => `• *${getAgent(item.agent).name}:* ${item.objective}`).join('\n');
      return `*${copy(state.language).teamPlan}:* ${run.plan.objective}\n\n${assignments}\n\n${run.plan.rationale}\n\n${run.plan.requiresOwnerApproval ? copy(state.language).approveTeam : copy(state.language).planned}`;
    }
    const signalPrefix = ['signals:', 'señales:', 'sinais:'].find((prefix) => normalized.startsWith(prefix));
    if (signalPrefix) {
      const signals = body.slice(signalPrefix.length), brain = await withLiveKnowledge(state.brain, this.knowledge, state.businessId, 'DIEGO', signals);
      const opportunity = await this.diego.detectOpportunity(brain, signals, state.language);
      state.pendingOpportunity = opportunity;
      await this.store.put(state);
      await this.store.audit(state.businessId, 'opportunity.proposed', opportunity);
      const labels = copy(state.language);
      return `📈 *${opportunity.insight_title}*\n\n${opportunity.observation}\n\n*${labels.recommendation}:* ${opportunity.recommendation}\n*${labels.impact}:* ${opportunity.predicted_impact}\n*${labels.confidence}:* ${Math.round(opportunity.confidence_score * 100)}%\n\n${labels.approve}`;
    }
    return this.diego.respond(await withLiveKnowledge(state.brain, this.knowledge, state.businessId, 'DIEGO', body), body, state.language);
  }
}

function currentQuestion(language: SupportedLanguage, step: number) {
  return `${step + 1}/10 — ${question(language, step)}`;
}

function copy(language: SupportedLanguage) {
  const values = {
    en: { welcome: "Welcome to BusiOS AI. I'm Diego, your AI business intelligence partner. Answer naturally—in a few words or as much detail as you like—to seed your Business Brain.", present: "I'm here. Your answer was not recorded, so we can continue safely.", languageChanged: 'Language changed to English.', complete: 'Your Business Brain is ready. Tell me what happened today, paste business signals, or ask what deserves your attention first.', recommendation: 'Recommendation', impact: 'Predicted impact', confidence: 'Confidence', approve: 'Reply *APPROVE* to authorize the plan or tell me what to change.', approved: (agents: string) => `Approved. I recorded the plan for ${agents}. External actions remain in safe simulation mode until each integration is verified.`, emptyMemory: 'Your Business Brain is empty.', correctionHelp: 'Use CORRECT field=value. Run MEMORY to see valid fields.', corrected: (field: string) => `Updated ${field} in the Business Brain.`, noRuns: 'No team runs yet. Use PLAN followed by an objective.', nothingToCancel: 'There is no pending team plan to cancel.', cancelled: 'The pending team plan was cancelled.', teamUnavailable: 'The team runtime is temporarily unavailable.', teamCompleted: 'The team completed its work.', teamPlan: 'Team plan', approveTeam: 'Reply *APPROVE* to authorize the team analysis or *CANCEL* to discard it.', planned: 'Plan recorded.', },
    es: { welcome: 'Bienvenido a BusiOS AI. Soy Diego, tu socio de inteligencia empresarial. Responde de forma natural—con unas palabras o con todos los detalles que desees—para crear el Cerebro de tu Negocio.', present: 'Aquí estoy. Tu mensaje no fue registrado como respuesta, así que podemos continuar con seguridad.', languageChanged: 'Idioma cambiado a español.', complete: 'El Cerebro de tu Negocio está listo. Cuéntame qué ocurrió hoy, comparte señales del negocio o pregúntame qué merece atención primero.', recommendation: 'Recomendación', impact: 'Impacto previsto', confidence: 'Confianza', approve: 'Responde *APPROVE* para autorizar el plan o dime qué deseas cambiar.', approved: (agents: string) => `Aprobado. Registré el plan para ${agents}. Las acciones externas permanecen en simulación segura hasta verificar cada integración.`, emptyMemory: 'El Cerebro de tu Negocio está vacío.', correctionHelp: 'Usa CORRECT campo=valor. Ejecuta MEMORY para ver los campos.', corrected: (field: string) => `Actualicé ${field} en el Cerebro del Negocio.`, noRuns: 'Todavía no hay trabajos del equipo. Usa PLAN seguido de un objetivo.', nothingToCancel: 'No hay ningún plan pendiente para cancelar.', cancelled: 'El plan pendiente fue cancelado.', teamUnavailable: 'El sistema del equipo no está disponible temporalmente.', teamCompleted: 'El equipo completó su trabajo.', teamPlan: 'Plan del equipo', approveTeam: 'Responde *APPROVE* para autorizar el análisis o *CANCEL* para descartarlo.', planned: 'Plan registrado.', },
    pt: { welcome: 'Bem-vindo ao BusiOS AI. Sou Diego, seu parceiro de inteligência empresarial. Responda naturalmente—com poucas palavras ou com todos os detalhes que desejar—para criar o Cérebro do seu Negócio.', present: 'Estou aqui. Sua mensagem não foi registrada como resposta, então podemos continuar com segurança.', languageChanged: 'Idioma alterado para português.', complete: 'O Cérebro do seu Negócio está pronto. Conte o que aconteceu hoje, envie sinais da empresa ou pergunte o que merece atenção primeiro.', recommendation: 'Recomendação', impact: 'Impacto previsto', confidence: 'Confiança', approve: 'Responda *APPROVE* para autorizar o plano ou diga o que deseja alterar.', approved: (agents: string) => `Aprovado. Registrei o plano para ${agents}. As ações externas permanecem em simulação segura até que cada integração seja verificada.`, emptyMemory: 'O Cérebro do seu Negócio está vazio.', correctionHelp: 'Use CORRECT campo=valor. Execute MEMORY para ver os campos.', corrected: (field: string) => `Atualizei ${field} no Cérebro do Negócio.`, noRuns: 'Ainda não há trabalhos da equipe. Use PLAN seguido de um objetivo.', nothingToCancel: 'Não há plano pendente para cancelar.', cancelled: 'O plano pendente foi cancelado.', teamUnavailable: 'O sistema da equipe está temporariamente indisponível.', teamCompleted: 'A equipe concluiu o trabalho.', teamPlan: 'Plano da equipe', approveTeam: 'Responda *APPROVE* para autorizar a análise ou *CANCEL* para descartar.', planned: 'Plano registrado.', }
  };
  return values[language];
}

function isCommand(value: string, commands: string[]) { return commands.includes(value.trim()); }
function parsePlan(body: string) { const match = body.trim().match(/^(?:plan|planear|planejar)\s*:?\s+(.+)/i); return match?.[1]?.trim() || null; }
function parseAsk(body: string): { agent: AgentId; objective: string } | null {
  const match = body.trim().match(/^(?:ask|preguntar|perguntar)\s+([a-z]+)\s*:?\s+(.+)/i);
  if (!match?.[1] || !match[2]) return null;
  const agent = agentIds.find((id) => id.toLowerCase() === match[1]?.toLowerCase());
  return agent ? { agent, objective: match[2].trim() } : null;
}
