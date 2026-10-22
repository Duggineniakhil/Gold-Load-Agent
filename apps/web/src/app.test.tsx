import { describe, expect, it } from 'vitest';
import { API_PREFIX } from '@tglobal/shared';

describe('web workspace', () => {
  it('can import the shared package source', () => {
    expect(API_PREFIX).toBe('/api/v1');
  });
});
