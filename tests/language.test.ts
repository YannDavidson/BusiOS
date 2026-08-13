import { describe, expect, it } from 'vitest';
import { detectLanguage, isConversationControl, requestedLanguage } from '../src/language.js';

describe('language handling', () => {
  it('detects English, Spanish, and Portuguese', () => {
    expect(detectLanguage('Hello, my business is a barbershop')).toBe('en');
    expect(detectLanguage('Hola, mi negocio está en San Juan')).toBe('es');
    expect(detectLanguage('Olá, meu negócio fica no Brasil')).toBe('pt');
  });
  it('uses location only as a fallback', () => {
    expect(detectLanguage('Keli', 'Puerto Rico')).toBe('es');
    expect(detectLanguage('Hello from Puerto Rico', 'Puerto Rico')).toBe('en');
  });
  it('recognizes language commands and interruptions', () => {
    expect(requestedLanguage('habla español')).toBe('es');
    expect(requestedLanguage('fale português')).toBe('pt');
    expect(isConversationControl('Are you there?')).toBe(true);
  });
});
