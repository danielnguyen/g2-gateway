import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { OrchestratorWorkResponseSchema } from '../src/models.js';
import { paginateText } from '../src/pagination.js';
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
      owner_id: 'owner-test',
      client_id: 'g2-test-client',
      surface: 'g2',
      allow_deferred: true,
      delivery_wait_ms: 15000,
      requested_scene: 'companion',
      surface_context: { interaction_mode: 'voice_mediated' }
    });
    expect(upstreamBody).not.toHaveProperty('retrieval');
    expect(fetchMock).toHaveBeenCalledTimes(1);

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
      allow_deferred: true,
      delivery_wait_ms: 15000,
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

const workId = '10000000-0000-4000-8000-000000000001';
const conversationId = '20000000-0000-4000-8000-000000000002';
const messageId = '30000000-0000-4000-8000-000000000003';
const otherId = '40000000-0000-4000-8000-000000000004';
const pendingSubmission = {
  request_id: 'request-deferred', conversation_id: conversationId,
  work_id: workId, delivery_status: 'pending'
};
const canonicalAnswer = 'Canonical result — exact evidence.\n\n' + 'A neutral retained detail. '.repeat(30);

describe('POST /g2/turn delivery', () => {
  it('preserves the complete synchronous page response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(orchestratorResponse());
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST', url: '/g2/turn', payload: { text: 'An ordinary turn' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      request_id: 'request-upstream', conversation_id: 'conversation-known',
      title: 'Ask', pages: ['Test answer'], source: 'chat-orchestrator',
      status: 'ok', raw_length: 'Test answer'.length
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it.each([
    ['ask', 'Ask'], ['brief', 'Brief'], ['recall', 'Recall'], ['status', 'Status']
  ])('forwards one %s submission and exposes only the exact 202 identity', async (mode, title) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(pendingSubmission, 202));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST', url: '/g2/turn',
      payload: {
        mode, text: 'Neutral request', conversation_id: conversationId,
        owner_id: 'untrusted-owner', client_id: 'untrusted-client'
      }
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ...pendingSubmission, title, source: 'chat-orchestrator' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://chat-orchestrator.test/v1/chat');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(init?.headers).toMatchObject({ 'x-api-key': 'co-test-key' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      owner_id: 'owner-test', client_id: 'g2-test-client', conversation_id: conversationId,
      surface: 'g2', requested_scene: 'companion', allow_deferred: true, delivery_wait_ms: 15000,
      response_mode: ['brief', 'status'].includes(mode!) ? 'brief' : 'normal',
      brief_type: mode === 'status' ? 'project_status' : 'general', interrupt_policy_mode: 'off',
      ...(['brief', 'status'].includes(mode!) ? { brief_depth: 1 } : {})
    });
    await app.close();
  });

  it.each([
    null,
    { ...pendingSubmission, work_id: 'invalid' },
    { ...pendingSubmission, conversation_id: otherId },
    { ...pendingSubmission, request_id: '' },
    { ...pendingSubmission, delivery_status: 'completed' },
    { ...pendingSubmission, answer: 'PRIVATE_RESPONSE_SENTINEL' },
    { ...pendingSubmission, pages: ['PRIVATE_RESPONSE_SENTINEL'] }
  ])('rejects malformed or mismatched deferred submissions without an answer', async (body) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, 202));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST', url: '/g2/turn',
      payload: { text: 'Neutral request', conversation_id: conversationId }
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'upstream_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it.each([201, 204, 302, 400, 404, 503, 'transport', 'invalid-json']) (
    'bounds submission failure %s without resubmission or conversation disposition', async (failure) => {
      const fetchMock = failingFetch(failure);
      vi.stubGlobal('fetch', fetchMock);
      const app = await buildTestApp();
      const response = await app.inject({
        method: 'POST', url: '/g2/turn', payload: { text: 'Neutral request', request_id: 'client-request' }
      });
      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: 'upstream_error', request_id: 'client-request' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
      await app.close();
    }
  );
});

describe('GET /g2/work-items/:work_id', () => {
  it.each(['', '   \n\t'])('rejects blank completed answer %j without fallback or resubmission', async (answer) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      ...workProjection('completed'), result: { assistant_message_id: messageId, answer }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: statusUrl() });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'upstream_error' });
    expect(response.json()).not.toHaveProperty('pages');
    expect(response.json()).not.toHaveProperty('answer');
    expect(response.body).not.toContain('No response.');
    assertStatusCalls(fetchMock, 1);
    await app.close();
  });

  it.each(['Canonical answer', ' Answer with surrounding whitespace ', '\nCanonical\nanswer\n'])(
    'preserves canonical answer %j unchanged during schema validation', (answer) => {
      const parsed = OrchestratorWorkResponseSchema.parse({
        ...workProjection('completed'), result: { assistant_message_id: messageId, answer }
      });
      expect(parsed.state).toBe('completed');
      expect(parsed.result?.answer).toBe(answer);
    }
  );

  it.each(['transport', 'http', 'schema'])(
    'keeps %s failure logs free of private upstream content', async (failure) => {
      const sentinel = 'PRIVATE_UPSTREAM_ANSWER_SENTINEL';
      const fetchMock = vi.fn<typeof fetch>();
      if (failure === 'transport') {
        fetchMock.mockRejectedValue(new Error(sentinel));
      } else if (failure === 'http') {
        fetchMock.mockResolvedValue(new Response(sentinel, { status: 503 }));
      } else {
        fetchMock.mockResolvedValue(jsonResponse({ ...workProjection('failed'), failure_code: sentinel }));
      }
      vi.stubGlobal('fetch', fetchMock);
      const logs: string[] = [];
      const app = await buildTestApp(logs);
      const response = await app.inject({ method: 'GET', url: statusUrl() });
      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: 'upstream_error' });
      expect(logs.join('')).toContain('failed to retrieve G2 work');
      expect(logs.join('')).not.toContain(sentinel);
      assertStatusCalls(fetchMock, 1);
      await app.close();
    }
  );

  it.each(['pending', 'running'] as const)('returns %s lifecycle only with one exact read', async (state) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(workProjection(state)));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: statusUrl() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...publicIdentity(), state });
    assertStatusCalls(fetchMock, 1);
    await app.close();
  });

  it('paginates only the canonical completed answer and never recomputes on repeated reads', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(workProjection('completed')));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();
    for (let count = 1; count <= 3; count++) {
      const response = await app.inject({ method: 'GET', url: statusUrl() });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ...publicIdentity(), state: 'completed', pages: paginateText(canonicalAnswer),
        raw_length: canonicalAnswer.length
      });
      expect(response.json().pages.length).toBeGreaterThan(1);
      expect(response.json()).not.toHaveProperty('answer');
      expect(response.json()).not.toHaveProperty('result');
      assertStatusCalls(fetchMock, count);
    }
    await app.close();
  });

  it.each(['interrupted', 'execution_failed', 'dependency_unavailable', 'authority_unavailable'])(
    'preserves the bounded failure %s without an answer', async (failureCode) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        ...workProjection('failed'), failure_code: failureCode
      }));
      vi.stubGlobal('fetch', fetchMock);
      const app = await buildTestApp();
      const response = await app.inject({ method: 'GET', url: statusUrl() });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ...publicIdentity(), state: 'failed', failure_code: failureCode });
      assertStatusCalls(fetchMock, 1);
      await app.close();
    }
  );

  it('ignores HUD owner authority and forwards only the exact supplied conversation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      ...workProjection('pending'), conversation_id: otherId
    }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/g2/work-items/${workId}?conversation_id=${otherId}&owner_id=untrusted-owner&client_id=untrusted-client`
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().conversation_id).toBe(otherId);
    assertStatusCalls(fetchMock, 1, otherId);
    await app.close();
  });

  it.each([
    `/g2/work-items/${workId}`,
    `/g2/work-items/${workId}?conversation_id=`,
    `/g2/work-items/${workId}?conversation_id=invalid`,
    `/g2/work-items/${workId}?conversation_id=${conversationId}&conversation_id=${otherId}`,
    `/g2/work-items/not-a-uuid?conversation_id=${conversationId}`
  ])('rejects invalid exact input %s without upstream calls', async (url) => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([201, 202, 204, 302, 400, 401, 403, 404, 500, 503, 'transport', 'invalid-json'])(
    'bounds upstream status failure %s with one GET and no chat retry', async (failure) => {
      const fetchMock = failingFetch(failure);
      vi.stubGlobal('fetch', fetchMock);
      const app = await buildTestApp();
      const response = await app.inject({ method: 'GET', url: statusUrl() });
      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: 'upstream_error' });
      assertStatusCalls(fetchMock, 1);
      await app.close();
    }
  );

  it.each([
    null,
    { ...workProjection('pending'), work_id: otherId },
    { ...workProjection('pending'), conversation_id: otherId },
    { ...workProjection('pending'), request_id: '' },
    { ...workProjection('pending'), state: 'unknown' },
    { ...workProjection('pending'), result: { assistant_message_id: messageId, answer: 'PRIVATE' } },
    { ...workProjection('running'), result: { assistant_message_id: messageId, answer: 'PRIVATE' } },
    { ...workProjection('failed'), failure_code: null },
    { ...workProjection('failed'), failure_code: 'PRIVATE_EXCEPTION' },
    { ...workProjection('failed'), result: { assistant_message_id: messageId, answer: 'PRIVATE' } },
    { ...workProjection('completed'), result: null },
    { ...workProjection('completed'), failure_code: 'interrupted' },
    { ...workProjection('completed'), result: { assistant_message_id: 'invalid', answer: 'PRIVATE' } },
    { ...workProjection('completed'), result: { assistant_message_id: messageId, answer: 123 } },
    { ...workProjection('completed'), result: { assistant_message_id: messageId, answer: 'PRIVATE', metadata: 'PRIVATE' } },
    { ...workProjection('completed'), owner_id: 'PRIVATE' },
    { ...workProjection('pending'), answer: 'PRIVATE' }
  ])('rejects inconsistent or private upstream work without fallback', async (body) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: statusUrl() });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'upstream_error' });
    assertStatusCalls(fetchMock, 1);
    await app.close();
  });
});

function publicIdentity() {
  return { work_id: workId, conversation_id: conversationId,
    request_id: 'request-deferred', source: 'chat-orchestrator' };
}

function workProjection(state: 'pending' | 'running' | 'completed' | 'failed') {
  return {
    work_id: workId, conversation_id: conversationId, request_id: 'request-deferred', state,
    failure_code: state === 'failed' ? 'interrupted' : null,
    result: state === 'completed' ? { assistant_message_id: messageId, answer: canonicalAnswer } : null
  };
}

function statusUrl() {
  return `/g2/work-items/${workId}?conversation_id=${conversationId}`;
}

function assertStatusCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, count: number, conversation = conversationId) {
  expect(fetchMock).toHaveBeenCalledTimes(count);
  for (const [input, init] of fetchMock.mock.calls) {
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(`http://chat-orchestrator.test/v1/work-items/${workId}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ owner_id: 'owner-test', conversation_id: conversation });
    expect(init).toEqual({ method: 'GET', redirect: 'error', headers: { 'x-api-key': 'co-test-key' } });
  }
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function failingFetch(failure: number | string) {
  const mock = vi.fn<typeof fetch>();
  if (failure === 'transport') return mock.mockRejectedValue(new Error('PRIVATE_TRANSPORT_SENTINEL'));
  return mock.mockResolvedValue(new Response(failure === 204 ? null : 'PRIVATE_RESPONSE_SENTINEL', {
    status: typeof failure === 'number' ? failure : 200
  }));
}

async function buildTestApp(logs?: string[]) {
  const config = loadConfig({
    G2_GATEWAY_TOKEN: 'gateway-test-token',
    G2_OWNER_ID: 'owner-test',
    G2_CLIENT_ID: 'g2-test-client',
    CHAT_ORCHESTRATOR_API_KEY: 'co-test-key',
    CHAT_ORCHESTRATOR_URL: 'http://chat-orchestrator.test'
  });
  const app = Fastify({
    logger: logs ? { level: 'error', stream: { write: (line: string) => { logs.push(line); } } } : false
  });
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
