import {
  API_PREFIX,
  type LeadRequest,
  type LeadStatus,
  type QuoteRequest,
  type RepaymentEstimateRequest,
  type StatusUpdateRequest,
} from '@tglobal/shared';

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
  status: LeadStatus;
  createdAt: string;
};

export type LeadPage = {
  items: LeadSummary[];
  nextCursor: string | null;
  filterSummary: string;
};
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

export type AuditEntry = { from: LeadStatus; to: LeadStatus; actor: string; at: string };
export type LeadAudit = {
  applicationId: string;
  status: LeadStatus;
  submittedAt: string;
  entries: AuditEntry[];
};
export type StatusChange = {
  applicationId: string;
  status: LeadStatus;
  updatedAt: string;
  entry: AuditEntry;
};

export type GoldRate = {
  ratePerGram24k: number;
  asOf: string;
  cachedUntil: string;
  source: string;
};

export type RepaymentEstimate = {
  planId: string;
  planName: string;
  repaymentType: 'EMI' | 'BULLET';
  annualInterestRate: number;
  tenureMonths: number;
  principalPaise: number;
  monthlyInstalmentPaise: number | null;
  totalInterestPaise: number;
  totalPayablePaise: number;
};

export type LeadStats = {
  total: number;
  byStatus: Record<LeadStatus, number>;
  totalEligibleLoanPaise: number;
};

export type FieldError = { field: string; message: string };
export type AppraisalSlipExtraction = {
  grossWeightGrams: string | null;
  netWeightGrams: string | null;
  karat: 18 | 22 | 24 | null;
};

const passcodeKey = 'tglobal.adminPasscode';

/** The admin passcode for this browser tab, sent as X-Admin-Passcode on admin calls only. */
export const adminSession = {
  get: () => sessionStorage.getItem(passcodeKey),
  set: (passcode: string) => sessionStorage.setItem(passcodeKey, passcode),
  clear: () => sessionStorage.removeItem(passcodeKey),
};

const adminHeaders = (): Record<string, string> => {
  const passcode = adminSession.get();
  return passcode ? { 'X-Admin-Passcode': passcode } : {};
};

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

const postJson = (
  body: unknown,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});

export const api = {
  plans: () => request<Plan[]>('/loan-schemes'),
  quote: (input: QuoteRequest, signal?: AbortSignal) =>
    request<Quote>('/quotes', postJson(input, signal)),
  /** The key makes retries of one submission safe: the server replays the first response. */
  submitLead: (input: LeadRequest, idempotencyKey: string) =>
    request<SubmittedLead>(
      '/leads',
      postJson(input, undefined, { 'Idempotency-Key': idempotencyKey }),
    ),
  goldRate: () => request<GoldRate>('/gold-rate'),
  repaymentEstimate: (input: RepaymentEstimateRequest, signal?: AbortSignal) =>
    request<RepaymentEstimate>('/repayment-estimates', postJson(input, signal)),
  extractAppraisalSlip: (imageDataUrl: string) =>
    request<AppraisalSlipExtraction>('/appraisal-slip/extract', postJson({ imageDataUrl })),
  leadStats: (planId: string) =>
    request<LeadStats>(`/leads/stats${planId ? `?planId=${encodeURIComponent(planId)}` : ''}`, {
      headers: adminHeaders(),
    }),
  updateStatus: (applicationId: string, change: StatusUpdateRequest) =>
    request<StatusChange>(`/leads/${encodeURIComponent(applicationId)}/status`, {
      ...postJson(change, undefined, adminHeaders()),
      method: 'PATCH',
    }),
  audit: (applicationId: string) =>
    request<LeadAudit>(`/leads/${encodeURIComponent(applicationId)}/audit`, {
      headers: adminHeaders(),
    }),
  leads: ({
    planId,
    cursor,
    filter,
  }: {
    planId: string;
    cursor?: string | null;
    filter?: string;
  }) => {
    const query = new URLSearchParams({ limit: String(LEADS_PAGE_SIZE) });
    if (planId) query.set('planId', planId);
    if (cursor) query.set('cursor', cursor);
    if (filter) query.set('filter', filter);
    return request<LeadPage>(`/leads?${query}`, { headers: adminHeaders() });
  },
};
