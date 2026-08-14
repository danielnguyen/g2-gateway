import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { makeBearerAuth } from '../src/auth.js';

const expectedToken = 'expected-gateway-secret';

describe('bearer authentication diagnostics', () => {
  it('allows a valid bearer token without logging a warning', async () => {
    const { request, warn } = testRequest({ authorization: `Bearer ${expectedToken}` });
    const reply = testReply();

    await makeBearerAuth(expectedToken)(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns 401 and safely fingerprints a mismatched bearer token', async () => {
    const receivedToken = 'received-gateway-secret';
    const { request, warn } = testRequest({
      authorization: `Bearer ${receivedToken}`,
      origin: 'https://vega.example',
      'user-agent': 'VEGA HUD test agent'
    });
    const reply = testReply();

    await makeBearerAuth(expectedToken)(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: 'unauthorized' });
    expect(warn).toHaveBeenCalledWith(
      {
        authFailure: {
          reason: 'bearer_token_mismatch',
          method: 'POST',
          route: '/g2/stt/session',
          origin: 'https://vega.example',
          userAgent: 'VEGA HUD test agent',
          authorizationHeaderExists: true,
          authorizationScheme: 'Bearer',
          receivedTokenLength: receivedToken.length,
          receivedTokenFingerprint: fingerprint(receivedToken),
          expectedTokenFingerprint: fingerprint(expectedToken)
        }
      },
      'g2 bearer authentication failed'
    );

    const diagnostic = JSON.stringify(warn.mock.calls);
    expect(diagnostic).not.toContain(receivedToken);
    expect(diagnostic).not.toContain(expectedToken);
    expect(diagnostic).not.toContain(`Bearer ${receivedToken}`);
  });

  it('distinguishes a missing authorization header', async () => {
    const { request, warn } = testRequest();
    const reply = testReply();

    await makeBearerAuth(expectedToken)(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: 'unauthorized' });
    expect(warn).toHaveBeenCalledWith(
      {
        authFailure: {
          reason: 'missing_header',
          method: 'POST',
          route: '/g2/stt/session',
          authorizationHeaderExists: false,
          expectedTokenFingerprint: fingerprint(expectedToken)
        }
      },
      'g2 bearer authentication failed'
    );
  });

  it('does not log an opaque malformed authorization value as a scheme', async () => {
    const rawAuthorizationValue = 'opaque-authorization-secret';
    const { request, warn } = testRequest({ authorization: rawAuthorizationValue });
    const reply = testReply();

    await makeBearerAuth(expectedToken)(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(warn).toHaveBeenCalledWith(
      {
        authFailure: {
          reason: 'non_bearer_scheme',
          method: 'POST',
          route: '/g2/stt/session',
          authorizationHeaderExists: true,
          expectedTokenFingerprint: fingerprint(expectedToken)
        }
      },
      'g2 bearer authentication failed'
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(rawAuthorizationValue);
  });

  it('distinguishes a non-Bearer authorization scheme without logging its token', async () => {
    const receivedToken = 'basic-scheme-secret';
    const { request, warn } = testRequest({ authorization: `Basic ${receivedToken}` });
    const reply = testReply();

    await makeBearerAuth(expectedToken)(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(warn).toHaveBeenCalledWith(
      {
        authFailure: {
          reason: 'non_bearer_scheme',
          method: 'POST',
          route: '/g2/stt/session',
          authorizationHeaderExists: true,
          authorizationScheme: 'Basic',
          receivedTokenLength: receivedToken.length,
          receivedTokenFingerprint: fingerprint(receivedToken),
          expectedTokenFingerprint: fingerprint(expectedToken)
        }
      },
      'g2 bearer authentication failed'
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(receivedToken);
  });
});

function testRequest(
  headers: Record<string, string> = {}
): { request: FastifyRequest; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const request = {
    method: 'POST',
    routeOptions: { url: '/g2/stt/session' },
    headers,
    log: { warn }
  } as unknown as FastifyRequest;

  return { request, warn };
}

function testReply(): FastifyReply {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn()
  } as unknown as FastifyReply;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
