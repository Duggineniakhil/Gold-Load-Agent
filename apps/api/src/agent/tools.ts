import {
  leadRequestSchema,
  quoteRequestSchema,
  type AgentApplicationSummary,
  type AgentToolName,
  type LeadRequest,
} from '@tglobal/shared';
import type { ZodError } from 'zod';
import { numberTokens } from './number-guard.js';
import { formatINR } from '../domain/money.js';
import { maskMobile } from '../domain/mobile.js';
import type { LoanSchemeRepository } from '../repositories/loan-scheme-repository.js';
import { listActiveLoanSchemes } from '../services/loan-scheme-service.js';
import { createQuotes } from '../services/quote-service.js';
import type { ToolDefinition } from './llm-client.js';

export type ToolContext = {
  loanSchemeRepository: LoanSchemeRepository;
  goldRatePaisePerGram: bigint;
};

export type PendingApplication = { input: LeadRequest; summary: AgentApplicationSummary };

export type ToolOutcome = {
  tool: AgentToolName | 'unknown';
  ok: boolean;
  /** JSON-serialisable result handed back to the model. */
  result: unknown;
  pending?: PendingApplication;
};

const weightProperty = (description: string) => ({
  type: 'string',
  description: `${description} in grams as a decimal string with at most 3 decimal places, e.g. "45" or "45.125".`,
});

const quoteProperties = {
  netWeightGrams: weightProperty('Net gold weight (excluding stones and fittings)'),
  grossWeightGrams: weightProperty('Gross weight of the item'),
  karat: { type: 'integer', enum: [18, 22, 24], description: 'Purity in karat.' },
};

// Advertised to the model in the plain JSON Schema subset every provider accepts.
// Arguments are always validated with the shared Zod schemas, never with these.
export const toolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_loan_schemes',
      description: 'List the active gold loan plans with interest rate, tenure and maximum LTV.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_quote',
      description:
        'Calculate pure gold, gold value and the eligible loan for every active plan. Use it for every figure you state.',
      parameters: {
        type: 'object',
        properties: quoteProperties,
        required: ['netWeightGrams', 'grossWeightGrams', 'karat'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_application',
      description:
        'Prepare the application for the borrower to confirm. Nothing is filed until the borrower presses Confirm on the summary card.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name, letters and spaces only.' },
          mobileNumber: {
            type: 'string',
            description: 'Indian 10-digit mobile number starting with 6-9.',
          },
          ...quoteProperties,
          planId: { type: 'string', description: 'A plan id returned by get_loan_schemes.' },
        },
        required: ['name', 'mobileNumber', 'netWeightGrams', 'grossWeightGrams', 'karat', 'planId'],
      },
    },
  },
];

function validationFailure(tool: AgentToolName, error: ZodError): ToolOutcome {
  return {
    tool,
    ok: false,
    result: {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some details are invalid. Ask the borrower to correct them.',
        fields: error.issues.map((issue) => ({
          field: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      },
    },
  };
}

async function quoteView(
  input: {
    netWeightGrams: string | number;
    grossWeightGrams: string | number;
    karat: 18 | 22 | 24;
  },
  context: ToolContext,
) {
  const quote = await createQuotes(
    input,
    context.loanSchemeRepository,
    context.goldRatePaisePerGram,
  );
  return {
    goldRatePerGram24k: formatINR(BigInt(quote.goldRatePerGram) * 100n),
    pureGoldGrams: quote.pureGoldGrams,
    goldValue: formatINR(quote.goldValuePaise),
    plans: quote.quotes.map((plan) => ({
      planId: plan.planId,
      planName: plan.name,
      ltvPercent: plan.ltvAppliedPercent,
      eligibleLoan: formatINR(plan.eligibleLoanPaise),
    })),
  };
}

/**
 * Argument fields the borrower never actually typed. The model must ask for a missing
 * detail rather than assume it, e.g. reusing a single stated weight as both net and gross:
 * each stated number can back only one field.
 */
export function ungroundedFields(args: Record<string, unknown>, borrowerText: string): string[] {
  const available = new Map<string, number>();
  for (const token of numberTokens(borrowerText))
    available.set(token, (available.get(token) ?? 0) + 1);
  const claim = (value: string | undefined) => {
    const count = value === undefined ? 0 : (available.get(value) ?? 0);
    if (count === 0) return false;
    available.set(value!, count - 1);
    return true;
  };

  const missing: string[] = (['netWeightGrams', 'grossWeightGrams', 'karat'] as const).filter(
    (field) => field in args && !claim(numberTokens(String(args[field]))[0]),
  );
  if ('mobileNumber' in args) {
    const typedDigits = borrowerText.replace(/(?<=\d)[\s-]+(?=\d)/g, '');
    if (!numberTokens(typedDigits).includes(String(args.mobileNumber)))
      missing.push('mobileNumber');
  }
  return missing;
}

function parseArguments(raw: string): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return undefined;
  }
}

export async function runTool(
  name: string,
  rawArguments: string,
  context: ToolContext,
  borrowerText: string,
): Promise<ToolOutcome> {
  const args = parseArguments(rawArguments);
  if (args === undefined || typeof args !== 'object' || args === null || Array.isArray(args)) {
    return {
      tool: 'unknown',
      ok: false,
      result: { error: { code: 'INVALID_ARGUMENTS', message: 'Arguments must be a JSON object.' } },
    };
  }

  if (name === 'calculate_quote' || name === 'submit_application') {
    const missing = ungroundedFields(args as Record<string, unknown>, borrowerText);
    if (missing.length > 0) {
      return {
        tool: name,
        ok: false,
        result: {
          error: {
            code: 'NOT_PROVIDED_BY_BORROWER',
            message:
              'The borrower has not stated these values. Ask them; never assume one weight equals the other.',
            fields: missing.map((field) => ({ field, message: 'Not provided by the borrower.' })),
          },
        },
      };
    }
  }

  switch (name) {
    case 'get_loan_schemes': {
      const plans = await listActiveLoanSchemes(context.loanSchemeRepository);
      return { tool: name, ok: true, result: { plans } };
    }
    case 'calculate_quote': {
      const parsed = quoteRequestSchema.safeParse(args);
      if (!parsed.success) return validationFailure(name, parsed.error);
      return { tool: name, ok: true, result: await quoteView(parsed.data, context) };
    }
    case 'submit_application': {
      const parsed = leadRequestSchema.safeParse(args);
      if (!parsed.success) return validationFailure(name, parsed.error);
      const input = parsed.data;
      const quote = await quoteView(input, context);
      const plan = quote.plans.find((item) => item.planId === input.planId);
      if (!plan) {
        return {
          tool: name,
          ok: false,
          result: {
            error: {
              code: 'PLAN_NOT_FOUND',
              message: 'That plan does not exist. Use a planId from get_loan_schemes.',
            },
          },
        };
      }
      const summary: AgentApplicationSummary = {
        name: input.name,
        mobileNumber: maskMobile(input.mobileNumber),
        grossWeightGrams: String(input.grossWeightGrams),
        netWeightGrams: String(input.netWeightGrams),
        karat: input.karat,
        planId: plan.planId,
        planName: plan.planName,
        pureGoldGrams: quote.pureGoldGrams,
        goldValue: quote.goldValue,
        eligibleLoan: plan.eligibleLoan,
        ltvPercent: plan.ltvPercent,
      };
      return {
        tool: name,
        ok: true,
        result: {
          status: 'AWAITING_BORROWER_CONFIRMATION',
          message:
            'A summary card is shown to the borrower. The application is filed only if they press Confirm.',
          summary,
        },
        pending: { input, summary },
      };
    }
    default:
      return {
        tool: 'unknown',
        ok: false,
        result: { error: { code: 'UNKNOWN_TOOL', message: `There is no tool named ${name}.` } },
      };
  }
}
