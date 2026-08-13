import { z } from 'zod';
import type { SupportedLanguage } from './language.js';
import { agentIds } from './agents/types.js';

export const onboardingFields = [
  'identity', 'offers', 'capacity', 'bottleneck', 'brandVibe',
  'financials', 'channels', 'promotionLimits', 'advantage', 'northStar'
] as const;

export type OnboardingField = (typeof onboardingFields)[number];
export type BusinessBrain = Partial<Record<OnboardingField, string>>;

export const opportunitySchema = z.object({
  insight_title: z.string().min(3),
  observation: z.string().min(10),
  recommendation: z.string().min(10),
  predicted_impact: z.string().min(2),
  confidence_score: z.number().min(0).max(1),
  evidence: z.array(z.object({ source: z.string(), signal: z.string() })).min(1),
  execution_payload: z.object({
    target_agents: z.array(z.enum(agentIds)),
    action_plan: z.array(z.object({ agent: z.enum(agentIds), action: z.string() })),
    requires_owner_approval: z.literal(true)
  })
});

export type Opportunity = z.infer<typeof opportunitySchema>;

export interface ConversationState {
  businessId: string;
  phone: string;
  language: SupportedLanguage;
  onboardingStep: number;
  brain: BusinessBrain;
  pendingOpportunity?: Opportunity;
}
