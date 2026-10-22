import { describe, expect, it } from 'vitest';
import { parsePlainEnglishLeadFilter } from '../src/services/lead-service.js';

describe('plain-English admin filters', () => {
  it('parses status, plan, and INR thresholds without floating-point conversion', () => {
    expect(parsePlainEnglishLeadFilter('pending applications over ₹1 lakh on EMI plan')).toEqual({
      status: 'SUBMITTED',
      repaymentType: 'EMI',
      minEligibleLoanPaise: 10_000_001n,
      summary: 'Filtered by awaiting review, EMI plan, loan over ₹1,00,000.',
    });
  });

  it('parses weight, karat, lower or upper amount, and a remaining name search', () => {
    expect(
      parsePlainEnglishLeadFilter('show approved net weight over 45.125 g for 22k Ravi'),
    ).toEqual({
      status: 'APPROVED',
      karat: 22,
      minNetWeightMg: 45_126,
      search: 'Ravi',
      summary: 'Filtered by approved, 22K gold, net weight over 45.125 g, matching “Ravi”.',
    });
    expect(parsePlainEnglishLeadFilter('loans below 2.5 lakh')).toMatchObject({
      maxEligibleLoanPaise: 24_999_999n,
    });
  });

  it('leaves an unrecognized phrase as a text search and does not invent a filter', () => {
    expect(parsePlainEnglishLeadFilter('Asha Rao')).toEqual({
      search: 'Asha Rao',
      summary: 'Filtered by matching “Asha Rao”.',
    });
  });
});
