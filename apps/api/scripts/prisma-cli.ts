import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(apiDirectory, 'prisma/schema.prisma');

// The CLI is located via its package.json "bin"; the package's main export points at a
// types-only entry that the published tarball does not ship.
const prismaPackagePath = require.resolve('prisma/package.json');
const { bin } = require(prismaPackagePath) as { bin: { prisma: string } };
const prismaCliPath = resolve(dirname(prismaPackagePath), bin.prisma);

export function deployMigrations(databaseUrl: string): void {
  execFileSync(process.execPath, [prismaCliPath, 'migrate', 'deploy', '--schema', schemaPath], {
    cwd: apiDirectory,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
