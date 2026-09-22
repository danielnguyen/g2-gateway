import type { AppConfig } from '../config.js';
import { OrchestratorDeferredResponseSchema, OrchestratorWorkResponseSchema } from '../models.js';
import type {
  OrchestratorSubmission, OrchestratorTurnRequest, OrchestratorTurnResponse,
  OrchestratorWorkResponse
} from '../models.js';

export class ChatOrchestratorClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string | undefined;
  private readonly ownerId: string;

  constructor(config: Pick<AppConfig,
    'CHAT_ORCHESTRATOR_URL' | 'CHAT_ORCHESTRATOR_API_KEY' | 'G2_OWNER_ID'>) {
    this.baseUrl = new URL(config.CHAT_ORCHESTRATOR_URL);
    this.apiKey = config.CHAT_ORCHESTRATOR_API_KEY;
    this.ownerId = config.G2_OWNER_ID;
  }

  async sendTurn(payload: OrchestratorTurnRequest): Promise<OrchestratorSubmission> {
    const url = new URL('/v1/chat', this.baseUrl);
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify(payload)
    });

    if (response.status === 202) {
      const result = OrchestratorDeferredResponseSchema.parse(await response.json());
      if (payload.conversation_id && result.conversation_id !== payload.conversation_id) {
        throw new Error('chat-orchestrator association mismatch');
      }
      return { status: 202, result };
    }

    if (response.status !== 200) {
      throw new Error('chat-orchestrator unavailable');
    }
    return { status: 200, result: (await response.json()) as OrchestratorTurnResponse };
  }

  async getWork(workId: string, conversationId: string): Promise<OrchestratorWorkResponse> {
    const url = new URL(`/v1/work-items/${encodeURIComponent(workId)}`, this.baseUrl);
    url.searchParams.set('owner_id', this.ownerId);
    url.searchParams.set('conversation_id', conversationId);
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: this.apiKey ? { 'x-api-key': this.apiKey } : {}
    });
    if (response.status !== 200) {
      throw new Error('chat-orchestrator unavailable');
    }
    const result = OrchestratorWorkResponseSchema.parse(await response.json());
    if (result.work_id !== workId || result.conversation_id !== conversationId) {
      throw new Error('chat-orchestrator association mismatch');
    }
    return result;
  }
}
