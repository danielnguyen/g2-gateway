import type { FastifyInstance } from 'fastify';
import type { SttTokenProvider } from '../clients/stt.js';

export async function registerSttRoutes(
  app: FastifyInstance,
  provider: SttTokenProvider | null
): Promise<void> {
  app.post('/g2/stt/session', async (_request, reply) => {
    if (!provider) {
      return reply.code(503).send({ error: 'stt_unavailable' });
    }

    try {
      const session = await provider.createSession();
      return reply.send({
        provider: session.provider,
        token: session.token,
        expires_in: session.expiresIn
      });
    } catch {
      return reply.code(502).send({ error: 'stt_upstream_error' });
    }
  });
}
