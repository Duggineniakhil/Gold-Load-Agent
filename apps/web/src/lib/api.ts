import { API_PREFIX, type LeadRequest, type QuoteRequest } from '@tglobal/shared';

export type Plan = {
  id: string;
  name: string;
  annualInterestRate: number;
  tenureMonths: number;
  maxLtv: number;
  repaymentType: 'BULLET' | 'EMI';
};

export type PlanQuote = {
  planId: string;
  name: string;
  ltvAppliedPercent: number;
  eligibleLoanPaise: number;
};

export type Quote = {
  goldRatePerGram: number;
  pureGoldGrams: string;
  goldValuePaise: number;
  quotes: PlanQuote[];
};

export type LeadSummary = {
  applicationId: string;
  name: string;
  mobileNumber: string;
  netWeightGrams: number;
  karat: number;
  planId: string;
  planName: string;
  eligibleLoanPaise: number;
  status: string;
  createdAt: string;
};

export type LeadPage = { items: LeadSummary[]; nextCursor: string | null };
export const LEADS_PAGE_SIZE = 20;

export type SubmittedLead = {
  applicationId: string;
  status: string;
  createdAt: string;
  quote: {
    planName: string;
    eligibleLoanPaise: number;
    goldValuePaise: number;
    pureGoldGrams: string;
  };
};

export type FieldError = { field: string; message: string };

/** An API error in the shared contract: { error: { code, message, fields } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldError[] = [],
    readonly existing?: { applicationId: string; createdAt: string },
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, init);
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'The server could not be reached. Check your connection and try again.',
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.fields ?? [],
      error?.existing,
    );
  }
  return payload as T;
}

const postJson = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});

export const api = {
  plans: () => request<Plan[]>('/loan-schemes'),
  quote: (input: QuoteRequest, signal?: AbortSignal) =>
    request<Quote>('/quotes', postJson(input, signal)),
  submitLead: (input: LeadRequest) => request<SubmittedLead>('/leads', postJson(input)),
  leads: ({ planId, cursor }: { planId: string; cursor?: string | null }) => {
    const query = new URLSearchParams({ limit: String(LEADS_PAGE_SIZE) });
    if (planId) query.set('planId', planId);
    if (cursor) query.set('cursor', cursor);
    return request<LeadPage>(`/leads?${query}`);
  },
};
