import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { env } from '../../src/config/env.js';

const require = createRequire(import.meta.url);
const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = resolve(apiDirectory, 'prisma/schema.prisma');
const prismaCliPath = require.resolve('prisma');
const testUrl = new URL(env.TEST_DATABASE_URL);
const testDatabaseName = testUrl.pathname.replace(/^\/+/, '');

if (!testDatabaseName.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must point to a database whose name ends with "_test".');
}

export async function openTestDatabase(): Promise<PrismaClient> {
  execFileSync(
    process.execPath,
    [prismaCliPath, 'migrate', 'deploy', '--schema', schemaPath],
    {
      cwd: apiDirectory,
      env: { ...process.env, DATABASE_URL: env.TEST_DATABASE_URL },
      stdio: 'inherit',
    },
  );

  const client = new PrismaClient({ datasourceUrl: env.TEST_DATABASE_URL });
  await client.$connect();
  return client;
}

export async function clearTestDatabase(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe('TRUNCATE TABLE "Lead", "LoanScheme" CASCADE');
  await client.$executeRawUnsafe('ALTER SEQUENCE "lead_application_seq" RESTART WITH 1001');
}

export async function closeTestDatabase(client: PrismaClient): Promise<void> {
  await client.$disconnect();
}
