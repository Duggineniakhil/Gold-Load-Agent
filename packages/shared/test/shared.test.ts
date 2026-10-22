import { describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/index.js';

describe('shared package', () => {
  it('exports the versioned API prefix', () => {
    expect(API_PREFIX).toBe('/api/v1');
  });
});
