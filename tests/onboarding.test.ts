import { describe, expect, it } from 'vitest';
import { onboardingComplete, question, recordAnswer } from '../src/onboarding.js';

describe('onboarding', () => {
  it('records structured answers without mutating prior state', () => {
    const original = {};
    const brain = recordAnswer(original, 0, ' Acme Barbers, Austin ');
    expect(brain).toEqual({ identity: 'Acme Barbers, Austin' });
    expect(original).toEqual({});
  });
  it('completes only after ten answers', () => {
    expect(onboardingComplete(9)).toBe(false);
    expect(onboardingComplete(10)).toBe(true);
  });
  it('provides localized, open-ended brand questions', () => {
    expect(question('en', 4)).toContain('a sentence');
    expect(question('es', 4)).toContain('una frase');
    expect(question('pt', 4)).toContain('uma frase');
  });
});
