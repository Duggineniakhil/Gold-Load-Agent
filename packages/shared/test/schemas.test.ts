import { describe, expect, it } from 'vitest';
import { mobileNumberSchema, nameSchema, quoteRequestSchema } from '../src/schemas.js';

describe('shared request schemas', () => {
  it('trims and collapses names while accepting unicode letters', () => {
    expect(nameSchema.parse('  Élodie   कुमार  ')).toBe('Élodie कुमार');
    expect(nameSchema.parse('अखिल दुग्गिनेनी')).toBe('अखिल दुग्गिनेनी');
    expect(nameSchema.parse('Élodie')).toBe('Élodie');
    expect(nameSchema.safeParse('Akhil123').success).toBe(false);
    expect(nameSchema.safeParse('िा').success).toBe(false);
  });

  it('validates Indian mobile numbers exactly', () => {
    expect(mobileNumberSchema.safeParse('9876543210').success).toBe(true);
    expect(mobileNumberSchema.safeParse('5876543210').success).toBe(false);
    expect(mobileNumberSchema.safeParse('98765').success).toBe(false);
  });

  it('validates gram precision and attaches net-over-gross errors to net weight', () => {
    expect(
      quoteRequestSchema.safeParse({
        netWeightGrams: '45.123',
        grossWeightGrams: '50',
        karat: 22,
      }).success,
    ).toBe(true);

    const result = quoteRequestSchema.safeParse({
      netWeightGrams: '52',
      grossWeightGrams: '50',
      karat: 22,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['netWeightGrams']);
  });
});
