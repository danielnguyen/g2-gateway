import { z } from 'zod';

export const G2TurnRequestSchema = z.object({
  session_id: z.string().min(1).default('g2-main'),
  conversation_id: z.string().min(1).optional(),
  mode: z.enum(['ask', 'brief', 'recall', 'status']).default('ask'),
  text: z.string().min(1).max(2_000),
  input_mode: z.enum(['tap_menu', 'typed', 'voice_transcribed']).default('tap_menu'),
  request_id: z.string().min(1).optional()
});

export type G2TurnRequest = z.infer<typeof G2TurnRequestSchema>;

export const G2PageResponseSchema = z.object({
  request_id: z.string(),
  conversation_id: z.string().optional(),
  title: z.string(),
  pages: z.array(z.string()).min(1),
  source: z.literal('chat-orchestrator'),
  status: z.enum(['ok', 'degraded', 'failed']).optional(),
  raw_length: z.number().int().nonnegative()
});

export type G2PageResponse = z.infer<typeof G2PageResponseSchema>;

export type OrchestratorTurnRequest = {
  owner_id: string;
  client_id: string;
  conversation_id?: string;
  surface: 'g2';
  surface_context: {
    surface_type: 'wearable_hud';
    interaction_mode: 'text' | 'voice_mediated';
    spoken_output: false;
    active_task_mode: boolean;
    latency_preference: 'low';
    verbosity_target: 'short';
    allows_expansion: false;
    output_format: 'plain_text';
    style_envelope: {
      directness: 'high';
      warmth: 'medium';
      playfulness_budget: 'none';
      sentence_length: 'short';
      technical_density: 'low';
      formality_range: 'casual';
      repetition_sensitivity: 'high';
    };
  };
  messages: Array<{
    role: 'user';
    content: string;
  }>;
  sensitivity: 'private';
  retrieval: {
    k: number;
    min_score: number;
    scope: 'owner';
    time_window: 'all';
    retrieval_mode: 'balanced';
  };
  response_mode: 'normal' | 'brief';
  brief_depth?: 0 | 1 | 2 | 3;
  brief_type: 'general' | 'project_status' | 'risk_review' | 'recommendation' | 'implementation_plan';
  interrupt_policy_mode: 'off';
};

export type OrchestratorTurnResponse = {
  request_id: string;
  conversation_id: string;
  profile_name: string;
  selected_model: string;
  answer: string;
  status: 'ok' | 'degraded' | 'failed';
  sources: Array<Record<string, unknown>>;
};
