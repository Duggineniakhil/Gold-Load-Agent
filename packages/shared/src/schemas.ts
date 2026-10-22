import { z } from 'zod';

// Each word starts with a letter; combining marks (\p{M}) are needed for Indic scripts, e.g. the vowel signs in कुमार.
const namePattern = /^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*$/u;
const mobilePattern = /^[6-9]\d{9}$/;
const gramsPattern = /^(?:\d+)(?:\.\d{1,3})?$/;

function validateGrams(value: string | number, ctx: z.RefinementCtx) {
  const text = String(value);
  if (!gramsPattern.test(text)) {
    ctx.addIssue({ code: 'custom', message: 'Use a weight with at most 3 decimal places.' });
    return;
  }

  const [whole = '0', fraction = ''] = text.split('.');
  const milligrams = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0');
  if (milligrams <= 0n) {
    ctx.addIssue({ code: 'custom', message: 'Weight must be greater than 0.' });
  } else if (milligrams > 1000000n) {
    ctx.addIssue({ code: 'custom', message: 'Weight must not exceed 1000 grams.' });
  }
}

export const nameSchema = z
  .string({ error: 'Enter the full name.' })
  .transform((value) => value.normalize('NFC').trim().replace(/ {2,}/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Enter at least 2 characters.')
      .max(60, 'Keep the name to 60 characters or fewer.')
      .regex(namePattern, 'Use letters and spaces only.'),
  );

export const mobileNumberSchema = z
  .string({ error: 'Enter a mobile number.' })
  .regex(mobilePattern, 'Enter a valid 10-digit Indian mobile number.');
export const grossWeightGramsSchema = z
  .union([z.string(), z.number().finite()], { error: 'Enter the gross weight in grams.' })
  .superRefine(validateGrams);
export const netWeightGramsSchema = z
  .union([z.string(), z.number().finite()], { error: 'Enter the net gold weight in grams.' })
  .superRefine(validateGrams);
export const karatSchema = z.union([z.literal(18), z.literal(22), z.literal(24)], {
  error: 'Choose 18, 22 or 24 karat.',
});
export const planIdSchema = z.string({ error: 'Choose a plan.' }).min(1, 'Choose a plan.');

function validateWeightOrder(
  value: { netWeightGrams: string | number; grossWeightGrams: string | number },
  ctx: z.RefinementCtx,
) {
  const toMg = (weight: string | number) => {
    const text = String(weight);
    if (!gramsPattern.test(text)) return null;
    const [whole = '0', fraction = ''] = text.split('.');
    return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0');
  };
  const netWeightMg = toMg(value.netWeightGrams);
  const grossWeightMg = toMg(value.grossWeightGrams);
  if (netWeightMg !== null && grossWeightMg !== null && netWeightMg > grossWeightMg) {
    ctx.addIssue({
      code: 'custom',
      path: ['netWeightGrams'],
      message: 'Net weight cannot exceed gross weight.',
    });
  }
}

export const quoteRequestSchema = z
  .object({
    netWeightGrams: netWeightGramsSchema,
    grossWeightGrams: grossWeightGramsSchema,
    karat: karatSchema,
  })
  .superRefine(validateWeightOrder);

export const appraisalSlipRequestSchema = z.object({
  imageDataUrl: z
    .string()
    .max(5_600_000, 'Choose an image smaller than 4 MB.')
    .regex(
      /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
      'Upload a JPEG, PNG or WebP image.',
    ),
});

export type AppraisalSlipRequest = z.infer<typeof appraisalSlipRequestSchema>;

export const leadRequestSchema = z
  .object({
    name: nameSchema,
    mobileNumber: mobileNumberSchema,
    grossWeightGrams: grossWeightGramsSchema,
    netWeightGrams: netWeightGramsSchema,
    karat: karatSchema,
    planId: planIdSchema,
  })
  .superRefine(validateWeightOrder);

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type LeadRequest = z.infer<typeof leadRequestSchema>;
export type RepaymentType = 'BULLET' | 'EMI';

export const agentMessageRequestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z
    .string()
    .trim()
    .min(1, 'Type a message.')
    .max(2000, 'Keep messages under 2000 characters.'),
});

export const agentConfirmRequestSchema = z.object({
  confirm: z.boolean(),
});

export type AgentMessageRequest = z.infer<typeof agentMessageRequestSchema>;
export type AgentConfirmRequest = z.infer<typeof agentConfirmRequestSchema>;

export const leadStatuses = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type LeadStatus = (typeof leadStatuses)[number];

/** The only status changes allowed. Shared so the API enforces and the UI offers the same moves. */
export const leadStatusTransitions: Record<LeadStatus, readonly LeadStatus[]> = {
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

export const canTransition = (from: LeadStatus, to: LeadStatus) =>
  leadStatusTransitions[from].includes(to);

export const leadStatusSchema = z.enum(leadStatuses, { error: 'Choose a valid status.' });

export const statusUpdateRequestSchema = z.object({
  status: leadStatusSchema,
  actor: z
    .string({ error: 'Enter who is making this change.' })
    .trim()
    .min(2, 'Enter at least 2 characters.')
    .max(60, 'Keep the name to 60 characters or fewer.'),
});

/** Printable ASCII, no spaces, up to 255 characters (a UUID is typical). */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[\x21-\x7E]{1,255}$/, 'Use 1–255 printable characters without spaces.');

export type StatusUpdateRequest = z.infer<typeof statusUpdateRequestSchema>;

/** Arguments of Loan Assist's check_existing_application tool. */
export const existingApplicationRequestSchema = z.object({ mobileNumber: mobileNumberSchema });

/** An illustrative repayment for a chosen loan amount on one plan (the calculator). */
export const repaymentEstimateRequestSchema = z.object({
  planId: planIdSchema,
  loanAmountRupees: z
    .number({ error: 'Enter the loan amount in rupees.' })
    .int('Use whole rupees.')
    .min(1000, 'Enter at least ₹1,000.')
    .max(10000000, 'Enter at most ₹1,00,00,000.'),
});

export type RepaymentEstimateRequest = z.infer<typeof repaymentEstimateRequestSchema>;
