import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default('0.0.0.0'),
  G2_GATEWAY_TOKEN: z.string().min(24),
  G2_OWNER_ID: z.string().min(1),
  G2_CLIENT_ID: z.string().min(1).default('even-realities-g2'),
  CHAT_ORCHESTRATOR_URL: z.string().url(),
  CHAT_ORCHESTRATOR_API_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().default('*')
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }

  return result.data;
}
