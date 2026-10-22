export type GoldRateSource = () => Promise<{ ratePaisePerGram: bigint; source: string }>;

export type GoldRate = {
  ratePaisePerGram: bigint;
  source: string;
  asOf: Date;
  cachedUntil: Date;
};

export interface GoldRateService {
  current(): Promise<GoldRate>;
}

/** The mock 24K rate from configuration, standing in for a market feed. */
export const mockGoldRateSource =
  (ratePaisePerGram: bigint): GoldRateSource =>
  async () => ({ ratePaisePerGram, source: 'mock' });

/**
 * Caches the 24K rate for `ttlMs`. Concurrent callers during a refresh share one fetch,
 * and a failed fetch is not cached, so the next call tries again.
 */
export function createGoldRateService({
  source,
  ttlMs = 60_000,
  now = () => Date.now(),
}: {
  source: GoldRateSource;
  ttlMs?: number;
  now?: () => number;
}): GoldRateService {
  let cached: GoldRate | null = null;
  let inFlight: Promise<GoldRate> | null = null;

  return {
    current() {
      if (cached && now() < cached.cachedUntil.getTime()) return Promise.resolve(cached);
      inFlight ??= source()
        .then(({ ratePaisePerGram, source: name }) => {
          const fetchedAt = now();
          cached = {
            ratePaisePerGram,
            source: name,
            asOf: new Date(fetchedAt),
            cachedUntil: new Date(fetchedAt + ttlMs),
          };
          return cached;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
