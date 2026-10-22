import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { createLeadRepository } from './repositories/lead-repository.js';
import { createLoanSchemeRepository } from './repositories/loan-scheme-repository.js';

const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const app = createApp({
  loanSchemeRepository: createLoanSchemeRepository(prisma),
  leadRepository: createLeadRepository(prisma),
  goldRatePaisePerGram: env.GOLD_RATE_24K_PAISE_PER_GRAM,
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API server listening');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => void prisma.$disconnect());
  });
}
