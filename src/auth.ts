import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

type AuthFailureReason =
  | 'missing_header'
  | 'non_bearer_scheme'
  | 'bearer_token_mismatch';

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export function makeBearerAuth(expectedToken: string) {
  return async function bearerAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authorizationHeader = request.headers.authorization;
    const token = extractBearerToken(authorizationHeader);

    if (!token || !safeEquals(token, expectedToken)) {
      logAuthFailure(request, authorizationHeader, expectedToken);
      await reply.code(401).send({ error: 'unauthorized' });
    }
  };
}

function logAuthFailure(
  request: FastifyRequest,
  authorizationHeader: string | undefined,
  expectedToken: string
): void {
  const [schemeCandidate, receivedToken] = authorizationHeader?.split(' ') ?? [];
  const authorizationScheme =
    receivedToken || schemeCandidate?.toLowerCase() === 'bearer' ? schemeCandidate : undefined;
  const reason: AuthFailureReason =
    authorizationHeader === undefined
      ? 'missing_header'
      : schemeCandidate?.toLowerCase() !== 'bearer'
        ? 'non_bearer_scheme'
        : 'bearer_token_mismatch';

  request.log.warn(
    {
      authFailure: {
        reason,
        method: request.method,
        route: request.routeOptions.url,
        ...(request.headers.origin ? { origin: request.headers.origin } : {}),
        ...(request.headers['user-agent']
          ? { userAgent: request.headers['user-agent'] }
          : {}),
        authorizationHeaderExists: authorizationHeader !== undefined,
        ...(authorizationScheme ? { authorizationScheme } : {}),
        ...(receivedToken
          ? {
              receivedTokenLength: receivedToken.length,
              receivedTokenFingerprint: fingerprint(receivedToken)
            }
          : {}),
        expectedTokenFingerprint: fingerprint(expectedToken)
      }
    },
    'g2 bearer authentication failed'
  );
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
