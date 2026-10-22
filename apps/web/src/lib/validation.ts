import {
  grossWeightGramsSchema,
  karatSchema,
  mobileNumberSchema,
  nameSchema,
  netWeightGramsSchema,
  quoteRequestSchema,
  type QuoteRequest,
} from '@tglobal/shared';

export type DetailsForm = {
  name: string;
  mobileNumber: string;
  grossWeightGrams: string;
  netWeightGrams: string;
  karat: number;
};
export type DetailsField = keyof DetailsForm;
export type DetailsErrors = Partial<Record<DetailsField, string>>;

const required: Record<Exclude<DetailsField, 'karat'>, string> = {
  name: 'Enter the full name.',
  mobileNumber: 'Enter a mobile number.',
  grossWeightGrams: 'Enter the gross weight in grams.',
  netWeightGrams: 'Enter the net gold weight in grams.',
};

type FieldSchema = {
  safeParse(
    value: unknown,
  ): { success: true } | { success: false; error: { issues: { message: string }[] } };
};

const fieldSchemas: Record<DetailsField, FieldSchema> = {
  name: nameSchema,
  mobileNumber: mobileNumberSchema,
  grossWeightGrams: grossWeightGramsSchema,
  netWeightGrams: netWeightGramsSchema,
  karat: karatSchema,
};

/** Validates the details step with the same shared Zod schemas the API uses. */
export function validateDetails(form: DetailsForm): DetailsErrors {
  return validateFields(form, Object.keys(fieldSchemas) as DetailsField[]);
}

export type WeightsForm = Pick<DetailsForm, 'grossWeightGrams' | 'netWeightGrams' | 'karat'>;

/** The weight and karat rules only, for the calculator. */
export function validateWeights(form: WeightsForm): DetailsErrors {
  return validateFields(form, ['grossWeightGrams', 'netWeightGrams', 'karat']);
}

function validateFields(
  form: Partial<DetailsForm> & WeightsForm,
  fields: DetailsField[],
): DetailsErrors {
  const errors: DetailsErrors = {};
  for (const field of fields) {
    const value = form[field];
    if (typeof value === 'string' && value.trim() === '' && field !== 'karat') {
      errors[field] = required[field];
      continue;
    }
    const result = fieldSchemas[field].safeParse(typeof value === 'string' ? value.trim() : value);
    if (!result.success) errors[field] = result.error.issues[0]?.message ?? 'Check this value.';
  }
  if (!errors.netWeightGrams && !errors.grossWeightGrams) {
    const order = quoteRequestSchema.safeParse(quoteFields(form));
    const issue = order.success
      ? undefined
      : order.error.issues.find((item) => item.path[0] === 'netWeightGrams');
    if (issue) errors.netWeightGrams = issue.message;
  }
  return errors;
}

function quoteFields(form: WeightsForm) {
  return {
    netWeightGrams: form.netWeightGrams.trim(),
    grossWeightGrams: form.grossWeightGrams.trim(),
    karat: form.karat,
  };
}

/** The quote request for the current weights, or null while they are incomplete or invalid. */
export function quoteInputFrom(form: WeightsForm): QuoteRequest | null {
  const parsed = quoteRequestSchema.safeParse(quoteFields(form));
  return parsed.success ? parsed.data : null;
}
