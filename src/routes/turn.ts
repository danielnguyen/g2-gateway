import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { ChatOrchestratorClient } from '../clients/chatOrchestrator.js';
import type { AppConfig } from '../config.js';
import { G2TurnRequestSchema } from '../models.js';
import { paginateText } from '../pagination.js';

export async function registerTurnRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const client = new ChatOrchestratorClient(config);

  app.post('/g2/turn', async (request, reply) => {
    const parsed = G2TurnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        details: parsed.error.flatten()
      });
    }

    const requestId = parsed.data.request_id ?? nanoid();
    const orchestratorPayload = {
      session_id: parsed.data.session_id,
      message: parsed.data.text,
      surface_context: {
        surface: 'g2' as const,
        surface_type: 'wearable_hud' as const,
        input_mode: parsed.data.input_mode
      },
      response_shape: {
        concise_first: true as const,
        max_chars: 700,
        paginate: true as const
      },
      metadata: {
        request_id: requestId,
        mode: parsed.data.mode
      }
    };

    try {
      const answer = await client.sendTurn(orchestratorPayload);
      return reply.send({
        request_id: requestId,
        title: titleForMode(parsed.data.mode),
        pages: paginateText(answer),
        source: 'chat-orchestrator',
        raw_length: answer.length
      });
    } catch (error) {
      request.log.error({ error, request_id: requestId }, 'failed to process G2 turn');
      return reply.code(502).send({
        error: 'upstream_error',
        request_id: requestId
      });
    }
  });
}

function titleForMode(mode: string): string {
  switch (mode) {
    case 'brief':
      return 'Brief';
    case 'recall':
      return 'Recall';
    case 'status':
      return 'Status';
    default:
      return 'Ask';
  }
}
