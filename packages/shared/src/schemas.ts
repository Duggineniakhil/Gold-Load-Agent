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
  .string()
  .transform((value) => value.normalize('NFC').trim().replace(/ {2,}/g, ' '))
  .pipe(z.string().min(2).max(60).regex(namePattern, 'Use letters and spaces only.'));

export const mobileNumberSchema = z.string().regex(mobilePattern, 'Enter a valid 10-digit Indian mobile number.');
export const grossWeightGramsSchema = z.union([z.string(), z.number().finite()]).superRefine(validateGrams);
export const netWeightGramsSchema = z.union([z.string(), z.number().finite()]).superRefine(validateGrams);
export const karatSchema = z.union([z.literal(18), z.literal(22), z.literal(24)]);
export const planIdSchema = z.string().min(1);

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
  message: z.string().trim().min(1, 'Type a message.').max(2000, 'Keep messages under 2000 characters.'),
});

export const agentConfirmRequestSchema = z.object({
  confirm: z.boolean(),
});

export type AgentMessageRequest = z.infer<typeof agentMessageRequestSchema>;
export type AgentConfirmRequest = z.infer<typeof agentConfirmRequestSchema>;
