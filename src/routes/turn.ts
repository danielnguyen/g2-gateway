import type { FastifyInstance } from 'fastify';
import { ChatOrchestratorClient } from '../clients/chatOrchestrator.js';
import type { AppConfig } from '../config.js';
import { G2TurnRequestSchema } from '../models.js';
import type { G2TurnRequest, OrchestratorTurnRequest } from '../models.js';
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

    const orchestratorPayload = buildOrchestratorPayload(parsed.data, config);

    try {
      const result = await client.sendTurn(orchestratorPayload);
      return reply.send({
        request_id: result.request_id,
        conversation_id: result.conversation_id,
        title: titleForMode(parsed.data.mode),
        pages: paginateText(result.answer),
        source: 'chat-orchestrator',
        status: result.status,
        raw_length: result.answer.length
      });
    } catch (error) {
      request.log.error({ error, client_request_id: parsed.data.request_id }, 'failed to process G2 turn');
      return reply.code(502).send({
        error: 'upstream_error',
        request_id: parsed.data.request_id
      });
    }
  });
}

function buildOrchestratorPayload(turn: G2TurnRequest, config: AppConfig): OrchestratorTurnRequest {
  const isVoiceMediated = turn.input_mode === 'voice_transcribed';
  const isBrief = turn.mode === 'brief' || turn.mode === 'status';

  return {
    owner_id: config.G2_OWNER_ID,
    client_id: config.G2_CLIENT_ID,
    ...(turn.conversation_id ? { conversation_id: turn.conversation_id } : {}),
    surface: 'g2',
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
    retrieval: {
      k: 6,
      min_score: 0.25,
      scope: 'owner',
      time_window: 'all',
      retrieval_mode: turn.mode === 'recall' ? 'historical' : 'balanced'
    },
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
