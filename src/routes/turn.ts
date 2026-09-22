import type { FastifyInstance } from 'fastify';
import { ChatOrchestratorClient } from '../clients/chatOrchestrator.js';
import type { AppConfig } from '../config.js';
import { G2TurnRequestSchema, G2WorkParamsSchema, G2WorkQuerySchema } from '../models.js';
import type {
  G2DeferredResponse, G2TurnRequest, G2WorkResponse, OrchestratorTurnRequest
} from '../models.js';
import { paginateText } from '../pagination.js';

// Leave 5 seconds inside the HUD's existing 20-second HTTP timeout for transport.
const DELIVERY_WAIT_MS = 15_000;

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

    const orchestratorPayload = buildOrchestratorPayload(parsed.data, config);

    try {
      const submission = await client.sendTurn(orchestratorPayload);
      if (submission.status === 202) {
        return reply.code(202).send({
          ...submission.result,
          title: titleForMode(parsed.data.mode),
          source: 'chat-orchestrator'
        } satisfies G2DeferredResponse);
      }
      const result = submission.result;
      return reply.send({
        request_id: result.request_id,
        conversation_id: result.conversation_id,
        title: titleForMode(parsed.data.mode),
        pages: paginateText(result.answer),
        source: 'chat-orchestrator',
        status: result.status,
        ...(result.conversation_disposition
          ? { conversation_disposition: result.conversation_disposition }
          : {}),
        raw_length: result.answer.length
      });
    } catch {
      request.log.error('failed to process G2 turn');
      return reply.code(502).send({
        error: 'upstream_error',
        request_id: parsed.data.request_id
      });
    }
  });

  app.get('/g2/work-items/:work_id', async (request, reply) => {
    const params = G2WorkParamsSchema.safeParse(request.params);
    const query = G2WorkQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    try {
      const work = await client.getWork(params.data.work_id, query.data.conversation_id);
      const identity = {
        work_id: work.work_id,
        conversation_id: work.conversation_id,
        request_id: work.request_id,
        source: 'chat-orchestrator' as const
      };
      let response: G2WorkResponse;
      if (work.state === 'completed') {
        response = {
          ...identity, state: work.state,
          pages: paginateText(work.result.answer), raw_length: work.result.answer.length
        };
      } else if (work.state === 'failed') {
        response = { ...identity, state: work.state, failure_code: work.failure_code };
      } else {
        response = { ...identity, state: work.state };
      }
      return reply.send(response);
    } catch {
      request.log.error('failed to retrieve G2 work');
      return reply.code(502).send({ error: 'upstream_error' });
    }
  });
}

function buildOrchestratorPayload(turn: G2TurnRequest, config: AppConfig): OrchestratorTurnRequest {
  const isVoiceMediated = turn.input_mode === 'voice_transcribed';
  const isBrief = turn.mode === 'brief' || turn.mode === 'status';

  return {
    allow_deferred: true,
    delivery_wait_ms: DELIVERY_WAIT_MS,
    owner_id: config.G2_OWNER_ID,
    client_id: config.G2_CLIENT_ID,
    ...(turn.conversation_id ? { conversation_id: turn.conversation_id } : {}),
    surface: 'g2',
    requested_scene: 'companion',
    surface_context: {
      surface_type: 'wearable_hud',
      interaction_mode: isVoiceMediated ? 'voice_mediated' : 'text',
      spoken_output: false,
      active_task_mode: true,
      latency_preference: 'low',
      verbosity_target: 'short',
      allows_expansion: false,
      output_format: 'plain_text',
      style_envelope: {
        directness: 'high',
        warmth: 'medium',
        playfulness_budget: 'none',
        sentence_length: 'short',
        technical_density: 'low',
        formality_range: 'casual',
        repetition_sensitivity: 'high'
      }
    },
    messages: [
      {
        role: 'user',
        content: turn.text
      }
    ],
    sensitivity: 'private',
    ...(turn.mode === 'recall'
      ? {
          retrieval: {
            k: 6,
            min_score: 0.25,
            scope: 'owner' as const,
            time_window: 'all' as const,
            retrieval_mode: 'historical' as const
          }
        }
      : {}),
    response_mode: isBrief ? 'brief' : 'normal',
    ...(isBrief ? { brief_depth: 1 as const } : {}),
    brief_type: briefTypeForMode(turn.mode),
    interrupt_policy_mode: 'off'
  };
}

function briefTypeForMode(mode: G2TurnRequest['mode']): OrchestratorTurnRequest['brief_type'] {
  switch (mode) {
    case 'status':
      return 'project_status';
    case 'brief':
      return 'general';
    case 'recall':
      return 'general';
    default:
      return 'general';
  }
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
