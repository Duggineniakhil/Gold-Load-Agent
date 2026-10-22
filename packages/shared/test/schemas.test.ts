import { describe, expect, it } from 'vitest';
import {
  leadRequestSchema,
  mobileNumberSchema,
  nameSchema,
  quoteRequestSchema,
} from '../src/schemas.js';

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

describe('validation boundaries', () => {
  const quote = (net: string, gross: string) =>
    quoteRequestSchema.safeParse({ netWeightGrams: net, grossWeightGrams: gross, karat: 22 })
      .success;

  it('allows net equal to gross, up to exactly 1000 g', () => {
    expect(quote('45', '45')).toBe(true);
    expect(quote('1000', '1000')).toBe(true);
    expect(quote('1000', '1000.001')).toBe(false);
    expect(quote('45.001', '45')).toBe(false);
    expect(quote('0', '1')).toBe(false);
    expect(quote('0.001', '1')).toBe(true);
  });

  it('accepts mobiles starting 6-9 only, with exactly 10 digits', () => {
    for (const first of '6789')
      expect(mobileNumberSchema.safeParse(`${first}123456789`).success).toBe(true);
    for (const first of '012345')
      expect(mobileNumberSchema.safeParse(`${first}123456789`).success).toBe(false);
    expect(mobileNumberSchema.safeParse('98765432101').success).toBe(false);
    expect(mobileNumberSchema.safeParse('+919876543210').success).toBe(false);
  });

  it('bounds names between 2 and 60 characters after trimming', () => {
    expect(nameSchema.safeParse('Al').success).toBe(true);
    expect(nameSchema.safeParse(' A ').success).toBe(false);
    expect(nameSchema.safeParse('   ').success).toBe(false);
    expect(nameSchema.safeParse('A'.repeat(60)).success).toBe(true);
    expect(nameSchema.safeParse('A'.repeat(61)).success).toBe(false);
  });

  it('rejects any karat other than 18, 22 or 24', () => {
    const lead = {
      name: 'Ravi Kumar',
      mobileNumber: '9876543210',
      grossWeightGrams: '50',
      netWeightGrams: '45',
      planId: 'PLAN_EMI_01',
    };
    expect(leadRequestSchema.safeParse({ ...lead, karat: 22 }).success).toBe(true);
    for (const karat of [14, 20, 23, '22'])
      expect(leadRequestSchema.safeParse({ ...lead, karat }).success).toBe(false);
  });
});
