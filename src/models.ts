import { z } from 'zod';

export const G2TurnRequestSchema = z.object({
  session_id: z.string().min(1).default('g2-main'),
  mode: z.enum(['ask', 'brief', 'recall', 'status']).default('ask'),
  text: z.string().min(1).max(2_000),
  input_mode: z.enum(['tap_menu', 'typed', 'voice_transcribed']).default('tap_menu'),
  request_id: z.string().min(1).optional()
});

export type G2TurnRequest = z.infer<typeof G2TurnRequestSchema>;

export const G2PageResponseSchema = z.object({
  request_id: z.string(),
  title: z.string(),
  pages: z.array(z.string()).min(1),
  source: z.literal('chat-orchestrator'),
  raw_length: z.number().int().nonnegative()
});

export type G2PageResponse = z.infer<typeof G2PageResponseSchema>;

export type OrchestratorTurnRequest = {
  session_id: string;
  message: string;
  surface_context: {
    surface: 'g2';
    surface_type: 'wearable_hud';
    input_mode: G2TurnRequest['input_mode'];
  };
  response_shape: {
    concise_first: true;
    max_chars: number;
    paginate: true;
  };
  metadata: {
    request_id: string;
    mode: G2TurnRequest['mode'];
  };
};

export type OrchestratorTurnResponse = {
  answer?: string;
  response?: string;
  text?: string;
  message?: string;
};
