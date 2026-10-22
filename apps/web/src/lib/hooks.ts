import { useEffect, useState } from 'react';
import type { QuoteRequest } from '@tglobal/shared';
import { api, ApiError, type GoldRate, type Plan, type Quote, type RepaymentEstimate } from './api';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api
      .plans()
      .then((data) => alive && setPlans(data))
      .catch(
        (reason: unknown) =>
          alive &&
          setError(reason instanceof Error ? reason.message : 'Plans could not be loaded.'),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { plans, loading, error };
}

/**
 * Server quote for the given input, re-requested about 300 ms after the input stops changing.
 * Stale responses are aborted so an older quote can never replace a newer one.
 */
export function useLiveQuote(input: QuoteRequest | null, delayMs = 300) {
  const key = input ? JSON.stringify(input) : '';
  const debouncedKey = useDebouncedValue(key, delayMs);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!debouncedKey) {
      setQuote(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api
      .quote(JSON.parse(debouncedKey) as QuoteRequest, controller.signal)
      .then((data) => {
        setQuote(data);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setQuote(null);
        setError(
          reason instanceof ApiError
            ? reason
            : new ApiError(0, 'UNKNOWN_ERROR', 'The quote could not be prepared.'),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [debouncedKey]);

  // While the latest input has not been quoted yet, the shown quote is out of date.
  const pending = key !== debouncedKey || loading;
  return { quote: key ? quote : null, pending: Boolean(key) && pending, error: key ? error : null };
}

/** Server-computed repayment for a plan and loan amount, re-requested ~300 ms after the amount settles. */
export function useRepaymentEstimate(planId: string, loanAmountRupees: number | null) {
  const key = planId && loanAmountRupees ? `${planId}:${loanAmountRupees}` : '';
  const debouncedKey = useDebouncedValue(key, 300);
  const [estimate, setEstimate] = useState<RepaymentEstimate | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!debouncedKey) {
      setEstimate(null);
      return;
    }
    const [plan = '', amount = '0'] = debouncedKey.split(':');
    const controller = new AbortController();
    api
      .repaymentEstimate({ planId: plan, loanAmountRupees: Number(amount) }, controller.signal)
      .then((data) => {
        setEstimate(data);
        setError('');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setEstimate(null);
        setError(
          reason instanceof Error
            ? reason.message
            : 'The repayment estimate could not be prepared.',
        );
      });
    return () => controller.abort();
  }, [debouncedKey]);

  return {
    estimate: key ? estimate : null,
    pending: key !== debouncedKey,
    error: key ? error : '',
  };
}

export function useGoldRate() {
  const [rate, setRate] = useState<GoldRate | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .goldRate()
      .then((data) => alive && setRate(data))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return rate;
}
