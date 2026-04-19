import { buildApp } from './app.js';

const { app } = buildApp();

async function start() {
  try {
    await app.listen({ port: 8080, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => app.log.error({ err }, 'uncaughtException'));
process.on('unhandledRejection', (err) => app.log.error({ err }, 'unhandledRejection'));

start();
