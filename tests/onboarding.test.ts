import { describe, expect, it } from 'vitest';
import { onboardingComplete, recordAnswer } from '../src/onboarding.js';

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
});
