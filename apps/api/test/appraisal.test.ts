import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../src/agent/llm-client.js';
import { createApp } from '../src/app.js';
import { extractAppraisalSlip } from '../src/services/appraisal-service.js';
import { fakeLeadRepository, fixedGoldRate } from './helpers/fixtures.js';

function appWithLlm(text: string) {
  const llm: LlmClient = {
    complete: async ({ messages }) => {
      const user = messages.find((message) => message.role === 'user');
      expect(Array.isArray(user?.content)).toBe(true);
      expect(user?.content).toContainEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,aGVsbG8=' },
      });
      return { role: 'assistant', content: text };
    },
  };
  return createApp({
    loanSchemeRepository: { findActive: async () => [] },
    leadRepository: fakeLeadRepository(),
    goldRate: fixedGoldRate(),
    logger: pino({ enabled: false }),
    llm,
  });
}

describe('appraisal-slip reading', () => {
  it('extracts validated values through the configured server-side model', async () => {
    const result = await extractAppraisalSlip('data:image/png;base64,aGVsbG8=', {
      complete: async () => ({
        role: 'assistant',
        content: '{"grossWeightGrams":"50.125","netWeightGrams":"45","karat":22}',
      }),
    });

    expect(result).toEqual({
      grossWeightGrams: '50.125',
      netWeightGrams: '45',
      karat: 22,
    });
  });

  it('returns a null for details the model cannot read', async () => {
    const result = await extractAppraisalSlip('data:image/png;base64,aGVsbG8=', {
      complete: async () => ({
        role: 'assistant',
        content: '{"grossWeightGrams":null,"netWeightGrams":null,"karat":null}',
      }),
    });

    expect(result).toEqual({
      grossWeightGrams: null,
      netWeightGrams: null,
      karat: null,
    });
  });

  it('does not accept out-of-range, unsupported, or contradictory readings', async () => {
    await expect(
      extractAppraisalSlip('data:image/png;base64,aGVsbG8=', {
        complete: async () => ({
          role: 'assistant',
          content: '{"grossWeightGrams":"40","netWeightGrams":"45","karat":20}',
        }),
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'APPRAISAL_UNREADABLE' });
  });

  it('validates image type before calling the model and preserves the API error shape', async () => {
    const app = appWithLlm('{"grossWeightGrams":"50","netWeightGrams":"45","karat":22}');
    const invalid = await request(app)
      .post('/api/v1/appraisal-slip/extract')
      .send({ imageDataUrl: 'data:text/plain;base64,aGVsbG8=' })
      .expect(400);
    expect(invalid.body.error.fields[0].field).toBe('imageDataUrl');

    const valid = await request(app)
      .post('/api/v1/appraisal-slip/extract')
      .send({ imageDataUrl: 'data:image/png;base64,aGVsbG8=' })
      .expect(200);
    expect(valid.body.karat).toBe(22);
  });
});
