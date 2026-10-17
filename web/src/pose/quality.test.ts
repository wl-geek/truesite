import { describe, expect, it } from 'vitest';
import { codeWidthPx, gradeQuality } from './quality';

describe('gradeQuality (spec 7.1 step 7)', () => {
  it.each([
    [1.0, 200, 'good'],
    [1.99, 121, 'good'],
    [2.0, 200, 'fair'], // RMS not under 2
    [1.0, 120, 'fair'], // width not over 120
    [3.99, 71, 'fair'],
    [4.0, 200, 'poor'],
    [1.0, 70, 'poor'],
    [Number.NaN, 200, 'poor'],
    [Infinity, 200, 'poor'],
  ] as const)('rms %s px, width %s px -> %s', (rms, w, q) => {
    expect(gradeQuality(rms, w)).toBe(q);
  });
  it('code width is the mean side length', () => {
    expect(codeWidthPx([[0, 0], [100, 0], [100, 50], [0, 50]])).toBe(75);
  });
});

describe('gradeQuality with a bad width (mutation-tested)', () => {
  it('is poor when the code width is not a number, however low the RMS', () => {
    expect(gradeQuality(1, Infinity)).toBe('poor');
    expect(gradeQuality(1, Number.NaN)).toBe('poor');
  });
});
