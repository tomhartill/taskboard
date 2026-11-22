import { buildApp } from './app';
import { loadConfig } from './config';
import { runMigrations } from './db/migrate';

const config = loadConfig();
await runMigrations(config.DATABASE_URL);
const { app } = await buildApp(config);

if (config.AUTH_MODE === 'dev') {
  app.log.warn('AUTH_MODE=dev: sign-in is off. Anyone who can reach this port can use the board.');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
