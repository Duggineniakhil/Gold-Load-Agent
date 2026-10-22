import { z } from 'zod';

const namePattern = /^[\p{L} ]+$/u;
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
  .transform((value) => value.trim().replace(/ {2,}/g, ' '))
  .pipe(z.string().min(2).max(60).regex(namePattern, 'Use letters and spaces only.'));

export const mobileNumberSchema = z.string().regex(mobilePattern, 'Enter a valid 10-digit Indian mobile number.');
export const grossWeightGramsSchema = z.union([z.string(), z.number().finite()]).superRefine(validateGrams);
export const netWeightGramsSchema = z.union([z.string(), z.number().finite()]).superRefine(validateGrams);
export const karatSchema = z.union([z.literal(18), z.literal(22), z.literal(24)]);
export const planIdSchema = z.string().min(1);

export const quoteRequestSchema = z
  .object({
    netWeightGrams: netWeightGramsSchema,
    grossWeightGrams: grossWeightGramsSchema,
    karat: karatSchema,
  })
  .superRefine((value, ctx) => {
    const toMg = (weight: string | number) => {
      const [whole = '0', fraction = ''] = String(weight).split('.');
      return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0');
    };
    if (toMg(value.netWeightGrams) > toMg(value.grossWeightGrams)) {
      ctx.addIssue({
        code: 'custom',
        path: ['netWeightGrams'],
        message: 'Net weight cannot exceed gross weight.',
      });
    }
  });

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type RepaymentType = 'BULLET' | 'EMI';
