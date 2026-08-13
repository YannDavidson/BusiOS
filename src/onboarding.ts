import { onboardingFields, type BusinessBrain } from './domain.js';
import type { SupportedLanguage } from './language.js';

export const onboardingQuestions: Record<SupportedLanguage, readonly string[]> = {
  en: [
    'What is your business name, location, and primary product or service?',
    'List your top 3–5 services or products, prices, and typical completion times.',
    'What are your operating hours and peak capacity?',
    'What is your biggest operational headache right now?',
    'In a few words or a sentence, how should customers perceive your brand?',
    'What are your target weekly revenue and average monthly overhead?',
    'Where do most customers find you, and which marketing accounts are active?',
    'What is the maximum discount or offer you permit, and what must never be discounted?',
    'Why do customers choose you over your strongest local competitor?',
    'What single result should BusiOS achieve for you in the next 30 days?'
  ],
  es: [
    '¿Cuál es el nombre, la ubicación y el producto o servicio principal de tu negocio?',
    'Enumera tus 3–5 servicios o productos principales, sus precios y el tiempo habitual de realización.',
    '¿Cuál es tu horario de atención y tu capacidad máxima?',
    '¿Cuál es tu mayor dificultad operativa en este momento?',
    'En unas palabras o una frase, ¿cómo deseas que los clientes perciban tu marca?',
    '¿Cuál es tu meta de ingresos semanales y tus gastos generales mensuales promedio?',
    '¿Dónde te encuentran la mayoría de tus clientes y qué cuentas de marketing utilizas?',
    '¿Cuál es el descuento u oferta máxima que permites y qué nunca debe descontarse?',
    '¿Por qué te eligen tus clientes frente a tu principal competidor local?',
    '¿Qué resultado único debería lograr BusiOS para ti durante los próximos 30 días?'
  ],
  pt: [
    'Qual é o nome, a localização e o principal produto ou serviço da sua empresa?',
    'Liste seus 3–5 principais serviços ou produtos, preços e tempos médios de conclusão.',
    'Qual é o seu horário de funcionamento e a capacidade máxima?',
    'Qual é o seu maior desafio operacional neste momento?',
    'Em algumas palavras ou uma frase, como você deseja que os clientes percebam sua marca?',
    'Qual é sua meta de receita semanal e sua despesa mensal média?',
    'Onde a maioria dos clientes encontra sua empresa e quais contas de marketing estão ativas?',
    'Qual é o maior desconto ou oferta permitido e o que nunca deve receber desconto?',
    'Por que os clientes escolhem sua empresa em vez do principal concorrente local?',
    'Qual resultado único o BusiOS deve alcançar para você nos próximos 30 dias?'
  ]
};

export function question(language: SupportedLanguage, step: number) {
  return onboardingQuestions[language][step];
}

export function recordAnswer(brain: BusinessBrain, step: number, answer: string) {
  const field = onboardingFields[step];
  if (!field) return brain;
  return { ...brain, [field]: answer.trim() };
}

export function onboardingComplete(step: number) {
  return step >= onboardingQuestions.en.length;
}
