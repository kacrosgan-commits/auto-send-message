import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'access_token',
      'refresh_token',
      'accessToken',
      'refreshToken',
      'accessTokenEncrypted',
      'refreshTokenEncrypted',
      'id_token',
      'token',
      'tokens',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  transport:
    config.nodeEnv === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
});
