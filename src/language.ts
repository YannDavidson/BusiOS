export type SupportedLanguage = 'en' | 'es' | 'pt';

const strongSignals: Record<SupportedLanguage, RegExp[]> = {
  en: [/\b(hello|hi|thanks|please|business|customers|revenue|hours|haircut|professional|friendly|care)\b/i],
  es: [/\b(hola|gracias|por favor|negocio|clientes|ingresos|horario|peluquer[ií]a|cortes?)\b/i, /[¿¡]/],
  pt: [/\b(ol[aá]|obrigad[oa]|por favor|neg[oó]cio|clientes|receita|hor[aá]rio|barbearia|cortes?)\b/i, /\b(voc[eê]|n[aã]o|tamb[eé]m)\b/i]
};

export function detectLanguage(message: string, locationHint = ''): SupportedLanguage | null {
  for (const language of ['es', 'pt', 'en'] as const) {
    if (strongSignals[language].some((pattern) => pattern.test(message))) return language;
  }
  const location = locationHint.toLowerCase();
  if (/brasil|brazil|portugal|s[aã]o paulo|rio de janeiro/.test(location)) return 'pt';
  if (/puerto rico|san juan|santurce|m[eé]xico|espa[nñ]a|colombia|argentina|per[uú]|chile/.test(location)) return 'es';
  return null;
}

export function requestedLanguage(message: string): SupportedLanguage | null {
  const value = message.trim().toLowerCase();
  if (/^(english|speak english|in english)$/.test(value)) return 'en';
  if (/^(espa[nñ]ol|habla espa[nñ]ol|en espa[nñ]ol)$/.test(value)) return 'es';
  if (/^(portugu[eê]s|fale portugu[eê]s|em portugu[eê]s)$/.test(value)) return 'pt';
  return null;
}

export function isConversationControl(message: string): boolean {
  const normalized = message.trim().replace(/^[¿¡!?.\s]+|[¿¡!?.\s]+$/g, '');
  return /^(hello|hi|hey|hola|buenas|ol[aá]|oi|are you there|est[aá]s ah[ií]|voc[eê] est[aá] a[ií]|resume|continue|repeat|status|contin[uú]a|repite|estado|continuar|repita)$/i.test(normalized);
}
