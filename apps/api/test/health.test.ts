import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('GET /api/v1/health', () => {
  it('returns a healthy response', async () => {
    await request(app).get('/api/v1/health').expect(200, { ok: true });
  });
});
