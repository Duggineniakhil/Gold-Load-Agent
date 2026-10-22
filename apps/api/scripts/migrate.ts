import { env } from '../src/config/env.js';
import { deployMigrations } from './prisma-cli.js';

deployMigrations(env.DATABASE_URL);
