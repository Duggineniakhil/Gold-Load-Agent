import express from 'express';
import type { HealthResponse } from '@tglobal/shared';
import { API_PREFIX } from '@tglobal/shared';
import { logger } from './logger.js';

export const app = express();

app.use(express.json());
app.get(`${API_PREFIX}/health`, (_request, response) => {
  const body: HealthResponse = { ok: true };
  response.json(body);
});

app.use((_request, response) => {
  response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found', fields: [] },
  });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ err: error }, 'Unhandled API error');
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', fields: [] },
  });
});
