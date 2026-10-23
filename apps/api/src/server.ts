import { PrismaClient } from '@prisma/client';
import { createLlmFromEnv } from './agent/llm-from-env.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { createLeadRepository } from './repositories/lead-repository.js';
import { createLoanSchemeRepository } from './repositories/loan-scheme-repository.js';
import { createAgentService } from './services/agent-service.js';
import { createGoldRateService, mockGoldRateSource } from './services/gold-rate-service.js';

const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const loanSchemeRepository = createLoanSchemeRepository(prisma);
const leadRepository = createLeadRepository(prisma);
const goldRate = createGoldRateService({
  source: mockGoldRateSource(env.GOLD_RATE_24K_PAISE_PER_GRAM),
});

const llm = createLlmFromEnv(env, logger);
const agent = llm
  ? createAgentService({ llm, loanSchemeRepository, leadRepository, goldRate, logger })
  : undefined;
if (!agent) logger.warn('No LLM API key is set; Loan Assist is disabled.');
if (!env.ADMIN_PASSCODE) logger.warn('ADMIN_PASSCODE is not set; the admin endpoints are open.');

const perMinute = (max: number) => (max > 0 ? { max, windowMs: 60_000 } : undefined);
const app = createApp({
  loanSchemeRepository,
  leadRepository,
  goldRate,
  agent,
  llm,
  adminPasscode: env.ADMIN_PASSCODE,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  rateLimits: {
    leads: perMinute(env.RATE_LIMIT_LEADS_PER_MINUTE),
    agent: perMinute(env.RATE_LIMIT_AGENT_PER_MINUTE),
  },
});

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, 'API server listening');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => void prisma.$disconnect());
  });
}
