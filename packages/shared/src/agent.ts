export type AgentToolName = 'get_loan_schemes' | 'calculate_quote' | 'submit_application';

export type AgentToolEvent = { tool: AgentToolName | 'unknown'; ok: boolean };

/** What the borrower reviews before an agent-prepared application is filed. All figures come from the server. */
export type AgentApplicationSummary = {
  name: string;
  mobileNumber: string;
  grossWeightGrams: string;
  netWeightGrams: string;
  karat: number;
  planId: string;
  planName: string;
  pureGoldGrams: string;
  goldValue: string;
  eligibleLoan: string;
  ltvPercent: number;
};

export type AgentSubmission =
  | { outcome: 'submitted'; applicationId: string; status: string; createdAt: string }
  | { outcome: 'duplicate'; applicationId: string; createdAt: string }
  | { outcome: 'cancelled' };

export type AgentTurnResponse = {
  sessionId: string;
  reply: string;
  toolEvents: AgentToolEvent[];
  pendingConfirmation: AgentApplicationSummary | null;
  submission: AgentSubmission | null;
};
