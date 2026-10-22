import pino from 'pino';

export const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'mobileNumber',
      '*.mobileNumber',
      'req.body.mobileNumber',
      'req.headers.x-mobile-number',
    ],
    censor: '[REDACTED]',
  },
});
