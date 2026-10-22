import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { fakeLeadRepository, fixedGoldRate, seededSchemes } from './helpers/fixtures.js';

const makeApp = (adminPasscode?: string) =>
  createApp({
    loanSchemeRepository: { findActive: async () => seededSchemes },
    leadRepository: fakeLeadRepository(),
    goldRate: fixedGoldRate(),
    logger: pino({ enabled: false }),
    adminPasscode,
  });

describe('admin passcode', () => {
  it('requires the passcode on every admin endpoint', async () => {
    const app = makeApp('open-sesame');

    for (const call of [
      () => request(app).get('/api/v1/leads'),
      () => request(app).get('/api/v1/leads/stats'),
      () => request(app).get('/api/v1/leads/GL-1001/audit'),
      () =>
        request(app)
          .patch('/api/v1/leads/GL-1001/status')
          .send({ status: 'UNDER_REVIEW', actor: 'Asha' }),
    ]) {
      const response = await call().expect(401);
      expect(response.body).toEqual({
        error: { code: 'ADMIN_AUTH_REQUIRED', message: 'Enter the admin passcode.', fields: [] },
      });
    }
  });

  it('accepts the right passcode and rejects a wrong one', async () => {
    const app = makeApp('open-sesame');
    await request(app).get('/api/v1/leads').set('X-Admin-Passcode', 'open-sesame').expect(200);
    await request(app).get('/api/v1/leads').set('X-Admin-Passcode', 'open-sesam').expect(401);
  });

  it('slows down guessing: the 11th wrong passcode in 15 minutes gets 429', async () => {
    const app = makeApp('open-sesame');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app)
        .get('/api/v1/leads/stats')
        .set('X-Admin-Passcode', `guess-${attempt}`)
        .expect(401);
    }
    const limited = await request(app)
      .get('/api/v1/leads/stats')
      .set('X-Admin-Passcode', 'guess-10')
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('leaves the public endpoints open and admin endpoints open when no passcode is set', async () => {
    await request(makeApp('open-sesame')).get('/api/v1/loan-schemes').expect(200);
    await request(makeApp('open-sesame')).post('/api/v1/quotes').send({}).expect(400);
    await request(makeApp()).get('/api/v1/leads/stats').expect(200);
  });
});
