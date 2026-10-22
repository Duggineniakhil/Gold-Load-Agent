import { PrismaClient } from '@prisma/client';
import { createOpenAiCompatibleClient } from './agent/llm-client.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { createLeadRepository } from './repositories/lead-repository.js';
import { createLoanSchemeRepository } from './repositories/loan-scheme-repository.js';
import { createAgentService } from './services/agent-service.js';

const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const loanSchemeRepository = createLoanSchemeRepository(prisma);
const leadRepository = createLeadRepository(prisma);
const goldRatePaisePerGram = env.GOLD_RATE_24K_PAISE_PER_GRAM;

const agent = env.LLM_API_KEY
  ? createAgentService({
      llm: createOpenAiCompatibleClient({
        baseUrl: env.LLM_BASE_URL,
        apiKey: env.LLM_API_KEY,
        model: env.LLM_MODEL,
        timeoutMs: env.LLM_TIMEOUT_MS,
      }),
      loanSchemeRepository,
      leadRepository,
      goldRatePaisePerGram,
      logger,
    })
  : undefined;
if (!agent) logger.warn('LLM_API_KEY is not set; Loan Assist is disabled.');

const app = createApp({ loanSchemeRepository, leadRepository, goldRatePaisePerGram, agent });

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, 'API server listening');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => void prisma.$disconnect());
  });
}
