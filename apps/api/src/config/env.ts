import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: resolve(fileURLToPath(new URL('../../../../.env', import.meta.url))) });

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/tglobal'),
  TEST_DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://postgres:postgres@localhost:5432/tglobal_test'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  GOLD_RATE_24K_PAISE_PER_GRAM: z.coerce.bigint().positive().default(700000n),
  LLM_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta/openai/'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
