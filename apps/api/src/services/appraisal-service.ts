import { grossWeightGramsSchema, netWeightGramsSchema } from '@tglobal/shared';
import { z } from 'zod';
import type { LlmClient } from '../agent/llm-client.js';
import { AppError } from '../errors.js';

const extractionSchema = z.object({
  grossWeightGrams: z.union([grossWeightGramsSchema, z.null()]).optional(),
  netWeightGrams: z.union([netWeightGramsSchema, z.null()]).optional(),
  karat: z.union([z.literal(18), z.literal(22), z.literal(24), z.null()]).optional(),
});

const responseSchema = z.object({
  grossWeightGrams: z.string().nullable(),
  netWeightGrams: z.string().nullable(),
  karat: z.union([z.literal(18), z.literal(22), z.literal(24)]).nullable(),
});

function parseExtraction(text: string) {
  const json = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new AppError(
      422,
      'APPRAISAL_UNREADABLE',
      'The appraisal details could not be read. Enter the weights and karat manually.',
    );
  }

  const parsed = extractionSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      422,
      'APPRAISAL_UNREADABLE',
      'The appraisal details were unclear. Enter the weights and karat manually.',
    );
  }

  const grossWeightGrams =
    parsed.data.grossWeightGrams == null ? null : String(parsed.data.grossWeightGrams);
  const netWeightGrams =
    parsed.data.netWeightGrams == null ? null : String(parsed.data.netWeightGrams);
  if (
    grossWeightGrams !== null &&
    netWeightGrams !== null &&
    gramsToMg(netWeightGrams) > gramsToMg(grossWeightGrams)
  ) {
    throw new AppError(
      422,
      'APPRAISAL_UNREADABLE',
      'The slip readings do not agree. Check the weights and enter them manually.',
    );
  }
  return responseSchema.parse({
    grossWeightGrams,
    netWeightGrams,
    karat: parsed.data.karat ?? null,
  });
}

function gramsToMg(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}

export async function extractAppraisalSlip(imageDataUrl: string, llm: LlmClient) {
  const base64 = imageDataUrl.slice(imageDataUrl.indexOf(',') + 1);
  const imageBytes = Buffer.from(base64, 'base64');
  if (imageBytes.byteLength > 4 * 1024 * 1024) {
    throw new AppError(413, 'IMAGE_TOO_LARGE', 'Choose an image smaller than 4 MB.');
  }

  const result = await llm.complete({
    messages: [
      {
        role: 'system',
        content:
          'Read only the appraisal slip image. Return one JSON object with grossWeightGrams and netWeightGrams as decimal strings in grams (at most 3 decimal places), and karat as 18, 22 or 24. Use null for any missing, unreadable, or unsupported value. Never infer or convert a value that is not printed on the slip. No markdown or extra text.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read the printed gross weight, net gold weight, and karat.' },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    tools: [],
  });
  if (!result.content) {
    throw new AppError(
      422,
      'APPRAISAL_UNREADABLE',
      'The appraisal details could not be read. Enter the weights and karat manually.',
    );
  }
  return parseExtraction(result.content);
}
