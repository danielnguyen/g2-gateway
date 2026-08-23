import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { registerTurnRoutes } from '../src/routes/turn.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /g2/turn conversation continuity', () => {
  it('forwards conversation_id and uses server-owned defaults for an ordinary turn', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      orchestratorResponse({ conversation_disposition: 'non_current' })
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/g2/turn',
      payload: {
        conversation_id: 'conversation-known',
        input_mode: 'voice_transcribed',
        text: 'Continue the thread'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      conversation_id: 'conversation-known',
      conversation_disposition: 'non_current'
    });
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(upstreamBody.conversation_id).toBe('conversation-known');
    expect(upstreamBody).toMatchObject({
      requested_scene: 'companion',
      surface_context: { interaction_mode: 'voice_mediated' }
    });
    expect(upstreamBody).not.toHaveProperty('retrieval');

    await app.close();
  });

  it('keeps the explicit historical retrieval override for recall mode', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(orchestratorResponse());
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/g2/turn',
      payload: { mode: 'recall', text: 'Recall the earlier details' }
    });

    expect(response.statusCode).toBe(200);
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(upstreamBody).toMatchObject({
      requested_scene: 'companion',
      retrieval: {
        k: 6,
        min_score: 0.25,
        scope: 'owner',
        time_window: 'all',
        retrieval_mode: 'historical'
      }
    });

    await app.close();
  });

  it('omits conversation_disposition when Chat Orchestrator omits it', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(orchestratorResponse()));
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/g2/turn',
      payload: { text: 'Start a turn' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('conversation_disposition');

    await app.close();
  });

  it('does not manufacture non_current on a generic upstream failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('dependency unavailable', { status: 503 }))
    );
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/g2/turn',
      payload: { conversation_id: 'conversation-known', text: 'Continue the thread' }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'upstream_error' });
    expect(response.json()).not.toHaveProperty('conversation_disposition');

    await app.close();
  });
});

async function buildTestApp() {
  const config = loadConfig({
    G2_GATEWAY_TOKEN: 'gateway-test-token',
    G2_OWNER_ID: 'owner-test',
    G2_CLIENT_ID: 'g2-test-client',
    CHAT_ORCHESTRATOR_URL: 'http://chat-orchestrator.test'
  });
  const app = Fastify();
  await registerTurnRoutes(app, config);
  return app;
}

function orchestratorResponse(extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      request_id: 'request-upstream',
      conversation_id: 'conversation-known',
      profile_name: 'companion',
      selected_model: 'test-model',
      answer: 'Test answer',
      status: 'ok',
      sources: [],
      ...extra
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }
  );
}
