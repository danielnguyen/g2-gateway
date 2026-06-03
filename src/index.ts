import 'dotenv/config';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { makeBearerAuth } from './auth.js';
import { loadConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerStatusRoutes } from './routes/status.js';
import { registerTurnRoutes } from './routes/turn.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN,
    credentials: false
  });

  await registerHealthRoutes(app);

  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.url === '/health') {
      return;
    }

    await makeBearerAuth(config.G2_GATEWAY_TOKEN)(request, reply);
  });

  await registerStatusRoutes(app);
  await registerTurnRoutes(app, config);

  await app.listen({
    host: config.HOST,
    port: config.PORT
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
