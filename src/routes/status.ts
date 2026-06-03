import type { FastifyInstance } from 'fastify';

export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/g2/status', async () => ({
    ok: true,
    surface: 'g2',
    modes: ['ask', 'brief', 'recall', 'status'],
    max_input_chars: 2000
  }));
}
