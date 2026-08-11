import { onboardingFields, type BusinessBrain } from './domain.js';

export const onboardingQuestions = [
  'What is your business name, location, and primary product or service?',
  'List your top 3–5 services or products, prices, and typical completion times.',
  'What are your operating hours and peak capacity?',
  'What is your biggest operational headache right now?',
  'In three words, how should customers perceive your brand?',
  'What are your target weekly revenue and average monthly overhead?',
  'Where do most customers find you, and which marketing accounts are active?',
  'What is the maximum discount or offer you permit, and what must never be discounted?',
  'Why do customers choose you over your strongest local competitor?',
  'What single result should BusiOS achieve for you in the next 30 days?'
] as const;

export function recordAnswer(brain: BusinessBrain, step: number, answer: string) {
  const field = onboardingFields[step];
  if (!field) return brain;
  return { ...brain, [field]: answer.trim() };
}

export function onboardingComplete(step: number) {
  return step >= onboardingQuestions.length;
}
