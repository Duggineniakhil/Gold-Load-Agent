import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  createGoldRateService,
  mockGoldRateSource,
  type GoldRateSource,
} from '../src/services/gold-rate-service.js';
import { seededSchemes } from './helpers/fixtures.js';

function countingSource(ratePaisePerGram = 700000n) {
  const calls = { count: 0 };
  const source: GoldRateSource = async () => {
    calls.count += 1;
    return { ratePaisePerGram, source: 'test' };
  };
  return { source, calls };
}

describe('gold-rate service', () => {
  it('serves the cached rate for 60 seconds, then refreshes', async () => {
    let clock = 1_000_000;
    const { source, calls } = countingSource();
    const service = createGoldRateService({ source, now: () => clock });

    const first = await service.current();
    clock += 59_999;
    await service.current();
    expect(calls.count).toBe(1);
    expect(first.cachedUntil.getTime() - first.asOf.getTime()).toBe(60_000);

    clock += 1;
    const refreshed = await service.current();
    expect(calls.count).toBe(2);
    expect(refreshed.asOf.getTime()).toBe(clock);
  });

  it('shares one fetch between concurrent callers', async () => {
    const { source, calls } = countingSource();
    const service = createGoldRateService({ source });
    const rates = await Promise.all(Array.from({ length: 10 }, () => service.current()));
    expect(calls.count).toBe(1);
    expect(new Set(rates.map((rate) => rate.asOf.getTime())).size).toBe(1);
  });

  it('does not cache a failed fetch', async () => {
    let attempts = 0;
    const service = createGoldRateService({
      source: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('feed down');
        return { ratePaisePerGram: 700000n, source: 'test' };
      },
    });
    await expect(service.current()).rejects.toThrow('feed down');
    await expect(service.current()).resolves.toMatchObject({ ratePaisePerGram: 700000n });
  });
});

describe('GET /api/v1/gold-rate', () => {
  it('returns the mock 24K rate with its cache window, without BigInt in the JSON', async () => {
    const app = createApp({
      loanSchemeRepository: { findActive: async () => seededSchemes },
      leadRepository: {
        findScheme: async () => null,
        withLocks: async () => {
          throw new Error('unused');
        },
        list: async () => [],
        findStatus: async () => null,
        transitionStatus: async () => null,
        auditLog: async () => [],
      },
      goldRate: createGoldRateService({ source: mockGoldRateSource(700000n) }),
      logger: pino({ enabled: false }),
    });

    const response = await request(app).get('/api/v1/gold-rate').expect(200);

    expect(response.body).toMatchObject({
      ratePerGram24k: 7000,
      ratePaisePerGram24k: 700000,
      currency: 'INR',
      source: 'mock',
    });
    expect(Date.parse(response.body.cachedUntil) - Date.parse(response.body.asOf)).toBe(60_000);
  });
});
