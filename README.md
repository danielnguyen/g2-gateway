# g2-gateway

Wearable-safe gateway between an Even Realities G2 app and the LLM Memory stack.

## Purpose

`g2-gateway` is a narrow public-facing adapter. It should be exposed through Cloudflare Tunnel at `g2.dann.cloud` and should not expose Node-RED, chat-orchestrator, or basic-memory-store directly.

Expected route:

```text
Even G2 app
→ https://g2.dann.cloud/g2/turn
→ Cloudflare Tunnel
→ g2-gateway
→ chat-orchestrator /v1/chat
```

## Endpoints

```text
GET  /health        unauthenticated health check
GET  /g2/status     authenticated surface capability check
POST /g2/turn       authenticated G2 turn endpoint
```

Authentication uses a simple bearer token:

```http
Authorization: Bearer <G2_GATEWAY_TOKEN>
```

## Local development

```bash
npm install
cp env.example .env
npm run dev
```

Required environment:

```text
G2_GATEWAY_TOKEN=long random token
CHAT_ORCHESTRATOR_URL=http://chat-orchestrator:8000
```

## Example request

```bash
curl -X POST http://localhost:8000/g2/turn \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $G2_GATEWAY_TOKEN" \
  -d '{"mode":"brief","text":"Give me my current brief"}'
```

## Container

Build locally:

```bash
podman build -f Containerfile -t g2-gateway:local .
```

Run with compose using `compose.example.yml`, adjusting the internal Docker network names as needed.

## Security boundary

Do not place Cloudflare Access service-token secrets or internal app API keys in the Even G2 app. The G2 app should only know the narrow gateway token. The gateway is responsible for internal calls.
