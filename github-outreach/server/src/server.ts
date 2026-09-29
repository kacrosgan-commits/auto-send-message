import { createApp } from './app';
import { config } from './config';
import { sqliteDatabasePath } from './lib/prisma';
import { logger } from './utils/logger';
import { ensureDefaultTemplate } from './services/template.service';

async function main(): Promise<void> {
  logger.info(`[Database] SQLite database: ${sqliteDatabasePath}`);
  logger.info(`[Outreach] Test mode: ${config.outreachTestMode ? 'on' : 'off'}`);
  if (config.tokenEncryptionKey.includes('replace-with')) {
    logger.warn('TOKEN_ENCRYPTION_KEY is still the example value. Replace it before connecting Gmail.');
  }
  await ensureDefaultTemplate();
  const app = createApp();
  app.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, 'GitHub Outreach listening');
  });
}

main().catch((error: unknown) => {
  logger.error({ message: error instanceof Error ? error.message : 'startup failed' }, 'Failed to start');
  process.exit(1);
});
