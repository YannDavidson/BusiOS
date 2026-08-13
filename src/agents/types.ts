import type { SupportedLanguage } from '../language.js';

export const agentIds = ['MARISOL', 'MIGUEL', 'ZULMA', 'ENRIQUE', 'LOLA', 'JULIO', 'MARIA', 'DIEGO'] as const;
export type AgentId = (typeof agentIds)[number];

export type ActionRisk = 'informational' | 'reversible' | 'consequential' | 'restricted';

export interface AgentAuthority {
  mayAnalyze: boolean;
  mayDraft: boolean;
  mayExecuteWithApproval: boolean;
  prohibitedActions: string[];
}

export interface AgentPersona {
  id: AgentId;
  name: string;
  title: string;
  reportsTo: AgentId | null;
  mission: string;
  personality: string[];
  voice: string[];
  expertise: string[];
  responsibilities: string[];
  inputs: string[];
  outputs: string[];
  tools: string[];
  collaboratesWith: AgentId[];
  escalationRules: string[];
  guardrails: string[];
  authority: AgentAuthority;
  languages: SupportedLanguage[];
}

export interface AgentAssignment {
  agent: AgentId;
  objective: string;
  risk: ActionRisk;
  requiresOwnerApproval: boolean;
}
