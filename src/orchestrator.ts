import { randomUUID } from 'node:crypto';
import type { IntelligenceEngine } from './diego.js';
import { onboardingComplete, onboardingQuestions, recordAnswer } from './onboarding.js';
import type { Store } from './store.js';

export class Orchestrator {
  constructor(private store: Store, private diego: IntelligenceEngine) {}

  async handle(phone: string, body: string): Promise<string> {
    let state = await this.store.get(phone);
    if (!state) {
      state = { businessId: randomUUID(), phone, onboardingStep: 0, brain: {} };
      await this.store.put(state);
      return `Welcome to BusiOS AI. I'm Diego, your AI business intelligence partner. I need 10 short answers to seed your Business Brain.\n\n1/10 — ${onboardingQuestions[0]}`;
    }
    const normalized = body.trim().toLowerCase();
    if (state.pendingOpportunity && ['approve', 'approve & execute', '1'].includes(normalized)) {
      await this.store.audit(state.businessId, 'opportunity.approved', state.pendingOpportunity);
      const targets = state.pendingOpportunity.execution_payload.target_agents.join(', ');
      state.pendingOpportunity = undefined;
      await this.store.put(state);
      return `Approved. I recorded the plan for ${targets}. This MVP keeps external sends in safe simulation mode until each integration is configured and verified.`;
    }
    if (!onboardingComplete(state.onboardingStep)) {
      state.brain = recordAnswer(state.brain, state.onboardingStep, body);
      state.onboardingStep += 1;
      await this.store.put(state);
      if (!onboardingComplete(state.onboardingStep)) return `${state.onboardingStep + 1}/10 — ${onboardingQuestions[state.onboardingStep]}`;
      await this.store.audit(state.businessId, 'onboarding.completed', { fields: Object.keys(state.brain) });
      return 'Your Business Brain is ready. Tell me what happened today, paste business signals, or ask what deserves your attention first.';
    }
    if (normalized.startsWith('signals:')) {
      const opportunity = await this.diego.detectOpportunity(state.brain, body.slice(8));
      state.pendingOpportunity = opportunity;
      await this.store.put(state);
      await this.store.audit(state.businessId, 'opportunity.proposed', opportunity);
      return `📈 *${opportunity.insight_title}*\n\n${opportunity.observation}\n\n*Recommendation:* ${opportunity.recommendation}\n*Predicted impact:* ${opportunity.predicted_impact}\n*Confidence:* ${Math.round(opportunity.confidence_score * 100)}%\n\nReply *APPROVE* to authorize the plan or tell me what to change.`;
    }
    return this.diego.respond(state.brain, body);
  }
}
