import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBearerAuth } from '../src/auth.js';
import { createSttTokenProvider } from '../src/clients/stt.js';
import { loadConfig } from '../src/config.js';
import { registerSttRoutes } from '../src/routes/stt.js';

const gatewayToken = 'gateway-test-token';
const deepgramApiKey = 'deepgram-test-api-key';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /g2/stt/session', () => {
  it('acquires and normalizes a short-lived Deepgram token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'temporary-token', expires_in: 47 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp(deepgramApiKey);

    const response = await app.inject({
      method: 'POST',
      url: '/g2/stt/session',
      headers: { authorization: `Bearer ${gatewayToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      provider: 'deepgram',
      token: 'temporary-token',
      expires_in: 47
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.deepgram.com/v1/auth/grant'
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { authorization: `Token ${deepgramApiKey}` }
    });

    await app.close();
  });

  it('returns a bounded 503 without calling a provider when the API key is absent', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/g2/stt/session',
      headers: { authorization: `Bearer ${gatewayToken}` }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'stt_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns a bounded 502 without exposing a Deepgram error body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('sensitive upstream details', { status: 403 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp(deepgramApiKey);

    const response = await app.inject({
      method: 'POST',
      url: '/g2/stt/session',
      headers: { authorization: `Bearer ${gatewayToken}` }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'stt_upstream_error' });
    expect(response.body).not.toContain('sensitive upstream details');

    await app.close();
  });

  it('returns a bounded 502 for a malformed Deepgram token response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ expires_in: 30 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    );
    const app = await buildTestApp(deepgramApiKey);

    const response = await app.inject({
      method: 'POST',
      url: '/g2/stt/session',
      headers: { authorization: `Bearer ${gatewayToken}` }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'stt_upstream_error' });

    await app.close();
  });

  it('returns a bounded 502 for a Deepgram network failure', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('network failure')));
    const app = await buildTestApp(deepgramApiKey);

    const response = await app.inject({
      method: 'POST',
      url: '/g2/stt/session',
      headers: { authorization: `Bearer ${gatewayToken}` }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'stt_upstream_error' });

    await app.close();
  });

  it('uses the existing bearer authentication boundary', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp(deepgramApiKey);

    const response = await app.inject({ method: 'POST', url: '/g2/stt/session' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });
});

describe('STT provider configuration', () => {
  it('rejects an unsupported provider instead of falling back', () => {
    expect(() =>
      loadConfig({
        G2_GATEWAY_TOKEN: gatewayToken,
        G2_OWNER_ID: 'owner-test',
        CHAT_ORCHESTRATOR_URL: 'http://chat-orchestrator.test',
        STT_PROVIDER: 'unsupported-provider'
      })
    ).toThrow(/STT_PROVIDER/);
  });
});

async function buildTestApp(apiKey?: string) {
  const config = loadConfig({
    G2_GATEWAY_TOKEN: gatewayToken,
    G2_OWNER_ID: 'owner-test',
    CHAT_ORCHESTRATOR_URL: 'http://chat-orchestrator.test',
    ...(apiKey ? { DEEPGRAM_API_KEY: apiKey } : {})
  });
  const app = Fastify();
  app.addHook('preHandler', makeBearerAuth(config.G2_GATEWAY_TOKEN));
  await registerSttRoutes(app, createSttTokenProvider(config));
  return app;
}
