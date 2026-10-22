import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.js';

const require = createRequire(import.meta.url);
const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(apiDirectory, 'prisma/schema.prisma');
const prismaCliPath = require.resolve('prisma');

execFileSync(
  process.execPath,
  [prismaCliPath, 'migrate', 'deploy', '--schema', schemaPath],
  {
    cwd: apiDirectory,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    stdio: 'inherit',
  },
);
