import type { AppConfig } from '../config.js';
import type { OrchestratorTurnRequest, OrchestratorTurnResponse } from '../models.js';

export class ChatOrchestratorClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string | undefined;

  constructor(config: Pick<AppConfig, 'CHAT_ORCHESTRATOR_URL' | 'CHAT_ORCHESTRATOR_API_KEY'>) {
    this.baseUrl = new URL(config.CHAT_ORCHESTRATOR_URL);
    this.apiKey = config.CHAT_ORCHESTRATOR_API_KEY;
  }

  async sendTurn(payload: OrchestratorTurnRequest): Promise<OrchestratorTurnResponse> {
    const url = new URL('/v1/chat', this.baseUrl);
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`chat-orchestrator returned ${response.status}: ${body.slice(0, 500)}`);
    }

    return (await response.json()) as OrchestratorTurnResponse;
  }
}
