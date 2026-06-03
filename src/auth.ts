import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

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
    const token = extractBearerToken(request.headers.authorization);

    if (!token || !safeEquals(token, expectedToken)) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  };
}
