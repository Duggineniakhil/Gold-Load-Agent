import { describe, expect, it } from 'vitest';
import { duplicateMessage, formatDate, formatRupees } from './format';

describe('formatRupees', () => {
  it('groups digits the Indian way', () => {
    expect(formatRupees(21656200)).toBe('₹2,16,562');
  });

  it('drops paise instead of rounding up', () => {
    expect(formatRupees(12833333)).toBe('₹1,28,333');
    expect(formatRupees(9999)).toBe('₹99');
  });
});

describe('dates and the duplicate message', () => {
  it('formats dates in Indian time', () => {
    expect(formatDate('2026-10-21T20:00:00.000Z')).toBe('22 Oct 2026');
  });

  it('matches the wording the spec asks for', () => {
    expect(
      duplicateMessage({ applicationId: 'GL-1042', createdAt: '2026-10-03T05:00:00.000Z' }),
    ).toBe('You already applied on 3 Oct, application GL-1042.');
  });
});
