import { randomUUID } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { z, ZodError } from 'zod';
import {
  agentConfirmRequestSchema,
  agentMessageRequestSchema,
  appraisalSlipRequestSchema,
  idempotencyKeySchema,
  leadRequestSchema,
  planIdSchema,
  quoteRequestSchema,
  repaymentEstimateRequestSchema,
  statusUpdateRequestSchema,
  API_PREFIX,
} from '@tglobal/shared';
import type { Logger } from 'pino';
import type { LlmClient } from './agent/llm-client.js';
import type { LeadRepository } from './repositories/lead-repository.js';
import type { LoanSchemeRepository } from './repositories/loan-scheme-repository.js';
import type { AgentService } from './services/agent-service.js';
import { listActiveLoanSchemes } from './services/loan-scheme-service.js';
import type { GoldRateService } from './services/gold-rate-service.js';
import {
  getLeadAudit,
  getLeadStats,
  listLeads,
  submitLeadRequest,
  updateLeadStatus,
} from './services/lead-service.js';
import { createQuotes } from './services/quote-service.js';
import { estimateLoanRepayment } from './services/repayment-service.js';
import { AppError, NotFoundError, ValidationError } from './errors.js';
import { logger as defaultLogger } from './logger.js';
import { createAdminGuard } from './admin-auth.js';
import { createRateLimiter, type RateLimitOptions } from './rate-limit.js';
import { extractAppraisalSlip } from './services/appraisal-service.js';

export type AppDependencies = {
  loanSchemeRepository: LoanSchemeRepository;
  leadRepository: LeadRepository;
  goldRate: GoldRateService;
  /** Absent when no LLM key is configured; the agent routes then answer 503. */
  agent?: AgentService | undefined;
  llm?: LlmClient | undefined;
  logger?: Logger;
  /** Per-IP limits; omitted (as in most tests) means no limit. */
  /** When set, the admin endpoints require it in the X-Admin-Passcode header. */
  adminPasscode?: string | undefined;
  rateLimits?: { leads?: RateLimitOptions | undefined; agent?: RateLimitOptions | undefined };
};

function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => ({
      field: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    throw new ValidationError('Request validation failed.', fields);
  }
  return parsed.data;
}

function parseHeader<T extends z.ZodType>(schema: T, value: string, header: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Request validation failed.', [
      { field: header, message: parsed.error.issues[0]?.message ?? 'Invalid header.' },
    ]);
  }
  return parsed.data;
}

function requireAgent(agent: AgentService | undefined): AgentService {
  if (!agent) {
    throw new AppError(
      503,
      'AGENT_NOT_CONFIGURED',
      'Loan Assist is not configured on this server. Set LLM_API_KEY or LLM_FALLBACK_API_KEY.',
    );
  }
  return agent;
}

function requireLlm(llm: LlmClient | undefined): LlmClient {
  if (!llm) {
    throw new AppError(
      503,
      'APPRAISAL_NOT_CONFIGURED',
      'Appraisal photo reading is not configured on this server.',
    );
  }
  return llm;
}

function replyChunks(text: string, size = 24): string[] {
  const characters = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += size) {
    chunks.push(characters.slice(index, index + size).join(''));
  }
  return chunks;
}

export function createApp(deps: AppDependencies) {
  const app = express();
  const noLimit: RequestHandler = (_request, _response, next) => next();
  const limitLeads = deps.rateLimits?.leads ? createRateLimiter(deps.rateLimits.leads) : noLimit;
  const requireAdmin = createAdminGuard(deps.adminPasscode);
  const limitAgent = deps.rateLimits?.agent ? createRateLimiter(deps.rateLimits.agent) : noLimit;

  app.use(
    pinoHttp({
      logger: deps.logger ?? defaultLogger,
      genReqId(request, response) {
        const supplied = request.headers['x-request-id'];
        const requestId =
          typeof supplied === 'string' && /^[\w-]{1,128}$/.test(supplied) ? supplied : randomUUID();
        response.setHeader('x-request-id', requestId);
        return requestId;
      },
    }),
  );
  app.use(express.json({ limit: '6mb' }));

  app.get(`${API_PREFIX}/health`, (_request, response) => {
    response.json({ ok: true });
  });

  app.get(`${API_PREFIX}/loan-schemes`, async (_request, response) => {
    response.json(await listActiveLoanSchemes(deps.loanSchemeRepository));
  });

  app.post(`${API_PREFIX}/quotes`, async (request, response) => {
    const input = parseOrThrow(quoteRequestSchema, request.body);
    const { ratePaisePerGram } = await deps.goldRate.current();
    response.json(await createQuotes(input, deps.loanSchemeRepository, ratePaisePerGram));
  });

  app.post(`${API_PREFIX}/repayment-estimates`, async (request, response) => {
    const input = parseOrThrow(repaymentEstimateRequestSchema, request.body);
    response.json(await estimateLoanRepayment(input, deps.loanSchemeRepository));
  });

  app.post(`${API_PREFIX}/leads`, limitLeads, async (request, response) => {
    const input = parseOrThrow(leadRequestSchema, request.body);
    const key = request.get('Idempotency-Key');
    const idempotencyKey =
      key === undefined ? undefined : parseHeader(idempotencyKeySchema, key, 'Idempotency-Key');
    const { ratePaisePerGram } = await deps.goldRate.current();
    const { response: body, replayed } = await submitLeadRequest(
      input,
      deps.leadRepository,
      ratePaisePerGram,
      idempotencyKey ? { key: idempotencyKey, body: request.body } : undefined,
    );
    if (replayed) response.setHeader('Idempotency-Replayed', 'true');
    response.status(201).json(body);
  });

  app.get(`${API_PREFIX}/leads/stats`, requireAdmin, async (request, response) => {
    const { planId } = parseOrThrow(z.object({ planId: planIdSchema.optional() }), request.query);
    response.json(await getLeadStats(deps.leadRepository, planId));
  });

  app.get(`${API_PREFIX}/leads`, requireAdmin, async (request, response) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().min(1).optional(),
      planId: planIdSchema.optional(),
      filter: z.string().trim().max(200).default(''),
    });
    const query = parseOrThrow(querySchema, request.query);
    response.json(await listLeads(deps.leadRepository, query));
  });

  app.patch(
    `${API_PREFIX}/leads/:applicationId/status`,
    requireAdmin,
    async (request, response) => {
      const update = parseOrThrow(statusUpdateRequestSchema, request.body);
      response.json(
        await updateLeadStatus(String(request.params.applicationId), update, deps.leadRepository),
      );
    },
  );

  app.get(`${API_PREFIX}/leads/:applicationId/audit`, requireAdmin, async (request, response) => {
    response.json(await getLeadAudit(String(request.params.applicationId), deps.leadRepository));
  });

  app.get(`${API_PREFIX}/gold-rate`, async (_request, response) => {
    const rate = await deps.goldRate.current();
    response.json({
      ratePerGram24k: Number(rate.ratePaisePerGram / 100n),
      ratePaisePerGram24k: Number(rate.ratePaisePerGram),
      currency: 'INR',
      source: rate.source,
      asOf: rate.asOf.toISOString(),
      cachedUntil: rate.cachedUntil.toISOString(),
    });
  });

  app.post(`${API_PREFIX}/agent/messages`, limitAgent, async (request, response) => {
    const input = parseOrThrow(agentMessageRequestSchema, request.body);
    response.json(await requireAgent(deps.agent).sendMessage(input));
  });

  app.post(`${API_PREFIX}/agent/messages/stream`, limitAgent, async (request, response) => {
    const input = parseOrThrow(agentMessageRequestSchema, request.body);
    const agent = requireAgent(deps.agent);
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('event: start\ndata: {}\n\n');
    try {
      const turn = await agent.sendMessage(input);
      for (const delta of replyChunks(turn.reply)) {
        if (response.destroyed) return;
        response.write(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`);
      }
      if (!response.destroyed) {
        response.write(`event: done\ndata: ${JSON.stringify(turn)}\n\n`);
        response.end();
      }
    } catch (error) {
      const shape =
        error instanceof AppError
          ? {
              code: error.code,
              message: error.message,
              fields: error.fields,
              ...error.extra,
            }
          : {
              code: 'INTERNAL_ERROR',
              message: 'An unexpected error occurred.',
              fields: [],
            };
      if (!(error instanceof AppError) || error.statusCode >= 500) {
        request.log.error({ err: error }, 'Loan Assist stream failed');
      }
      if (!response.destroyed) {
        response.write(`event: error\ndata: ${JSON.stringify({ error: shape })}\n\n`);
        response.end();
      }
    }
  });

  app.post(`${API_PREFIX}/appraisal-slip/extract`, limitAgent, async (request, response) => {
    const input = parseOrThrow(appraisalSlipRequestSchema, request.body);
    response.json(await extractAppraisalSlip(input.imageDataUrl, requireLlm(deps.llm)));
  });

  app.post(
    `${API_PREFIX}/agent/sessions/:sessionId/confirm`,
    limitAgent,
    async (request, response) => {
      const { confirm } = parseOrThrow(agentConfirmRequestSchema, request.body);
      response.json(
        await requireAgent(deps.agent).confirm(String(request.params.sessionId), confirm),
      );
    },
  );

  app.use((_request, _response, next) => next(new NotFoundError()));

  app.use(
    (
      error: unknown,
      request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      if (error instanceof AppError) {
        if (error.statusCode >= 500) request.log.error({ err: error }, 'API dependency error');
        response.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
            fields: error.fields,
            ...error.extra,
          },
        });
        return;
      }

      if (error instanceof ZodError) {
        const fields = error.issues.map((issue) => ({
          field: issue.path.map(String).join('.'),
          message: issue.message,
        }));
        response.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', fields },
        });
        return;
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        error.type === 'entity.parse.failed'
      ) {
        response.status(400).json({
          error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', fields: [] },
        });
        return;
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        error.type === 'entity.too.large'
      ) {
        response.status(413).json({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Request body exceeds the 6 MB limit.',
            fields: [],
          },
        });
        return;
      }

      request.log.error({ err: error }, 'Unhandled API error');
      response.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          fields: [],
        },
      });
    },
  );

  return app;
}
