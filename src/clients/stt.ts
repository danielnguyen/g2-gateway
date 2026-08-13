import type { AppConfig } from '../config.js';

const DEEPGRAM_GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';
const DEEPGRAM_TIMEOUT_MS = 5_000;

export type SttSession = {
  provider: string;
  token: string;
  expiresIn: number;
};

export interface SttTokenProvider {
  createSession(): Promise<SttSession>;
}

export function createSttTokenProvider(
  config: Pick<AppConfig, 'STT_PROVIDER' | 'DEEPGRAM_API_KEY'>
): SttTokenProvider | null {
  if (!config.DEEPGRAM_API_KEY) {
    return null;
  }

  return new DeepgramSttTokenProvider(config.DEEPGRAM_API_KEY);
}

export class DeepgramSttTokenProvider implements SttTokenProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async createSession(): Promise<SttSession> {
    let response: Response;

    try {
      response = await this.fetchImpl(DEEPGRAM_GRANT_URL, {
        method: 'POST',
        headers: {
          authorization: `Token ${this.apiKey}`
        },
        signal: AbortSignal.timeout(DEEPGRAM_TIMEOUT_MS)
      });
    } catch {
      throw new Error('stt_upstream_error');
    }

    if (!response.ok) {
      throw new Error('stt_upstream_error');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('stt_upstream_error');
    }

    if (!isDeepgramGrantResponse(body)) {
      throw new Error('stt_upstream_error');
    }

    return {
      provider: 'deepgram',
      token: body.access_token,
      expiresIn: body.expires_in
    };
  }
}

function isDeepgramGrantResponse(
  value: unknown
): value is { access_token: string; expires_in: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.access_token === 'string' &&
    candidate.access_token.trim().length > 0 &&
    typeof candidate.expires_in === 'number' &&
    Number.isFinite(candidate.expires_in) &&
    candidate.expires_in > 0
  );
}
