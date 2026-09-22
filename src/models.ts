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
  conversation_disposition: z.literal('non_current').optional(),
  raw_length: z.number().int().nonnegative()
});

export type G2PageResponse = z.infer<typeof G2PageResponseSchema>;

export type OrchestratorTurnRequest = {
  allow_deferred: true;
  delivery_wait_ms: number;
  owner_id: string;
  client_id: string;
  conversation_id?: string;
  surface: 'g2';
  requested_scene: 'companion';
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
  retrieval?: {
    k: number;
    min_score: number;
    scope: 'owner';
    time_window: 'all';
    retrieval_mode: 'recent' | 'balanced' | 'historical';
  };
  response_mode: 'normal' | 'brief';
  brief_depth?: 0 | 1 | 2 | 3;
  brief_type: 'general' | 'project_status' | 'risk_review' | 'recommendation' | 'implementation_plan';
  interrupt_policy_mode: 'off';
};

export type OrchestratorTurnResponse = {
  request_id: string;
  conversation_id?: string;
  profile_name: string;
  selected_model: string;
  answer: string;
  status: 'ok' | 'degraded' | 'failed';
  sources: Array<Record<string, unknown>>;
  conversation_disposition?: 'non_current';
};

const WorkIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
);
const RequestIdSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const G2WorkParamsSchema = z.object({ work_id: WorkIdSchema });
// Extra query fields cannot supply owner authority; only conversation_id is consumed.
export const G2WorkQuerySchema = z.object({ conversation_id: WorkIdSchema });

export const OrchestratorDeferredResponseSchema = z.object({
  request_id: RequestIdSchema,
  conversation_id: WorkIdSchema,
  work_id: WorkIdSchema,
  delivery_status: z.literal('pending')
}).strict();

export type OrchestratorSubmission =
  | { status: 200; result: OrchestratorTurnResponse }
  | { status: 202; result: z.infer<typeof OrchestratorDeferredResponseSchema> };

export const G2DeferredResponseSchema = OrchestratorDeferredResponseSchema.extend({
  title: z.string(),
  source: z.literal('chat-orchestrator')
});
export type G2DeferredResponse = z.infer<typeof G2DeferredResponseSchema>;

const WorkFailureSchema = z.enum([
  'interrupted', 'execution_failed', 'dependency_unavailable', 'authority_unavailable'
]);
const WorkIdentitySchema = z.object({
  work_id: WorkIdSchema,
  conversation_id: WorkIdSchema,
  request_id: RequestIdSchema
});
export const OrchestratorWorkResponseSchema = z.discriminatedUnion('state', [
  WorkIdentitySchema.extend({
    state: z.literal('pending'), failure_code: z.null(), result: z.null()
  }).strict(),
  WorkIdentitySchema.extend({
    state: z.literal('running'), failure_code: z.null(), result: z.null()
  }).strict(),
  WorkIdentitySchema.extend({
    state: z.literal('failed'), failure_code: WorkFailureSchema, result: z.null()
  }).strict(),
  WorkIdentitySchema.extend({
    state: z.literal('completed'),
    failure_code: z.null(),
    result: z.object({ assistant_message_id: WorkIdSchema, answer: z.string() }).strict()
  }).strict()
]);
export type OrchestratorWorkResponse = z.infer<typeof OrchestratorWorkResponseSchema>;

export type G2WorkResponse = z.infer<typeof WorkIdentitySchema> & {
  source: 'chat-orchestrator';
} & (
  | { state: 'pending' | 'running' }
  | { state: 'failed'; failure_code: z.infer<typeof WorkFailureSchema> }
  | { state: 'completed'; pages: string[]; raw_length: number }
);
