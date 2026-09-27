export interface Config {
  databaseUrl: string;
  jwtSecret: string;
  adminApiKey: string;
  webhookSecret: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  const jwtSecret = env.JWT_SECRET;
  const adminApiKey = env.ADMIN_API_KEY;
  const webhookSecret = env.WEBHOOK_SECRET;
  if (!databaseUrl || !jwtSecret || !adminApiKey || !webhookSecret) {
    throw new Error('DATABASE_URL, JWT_SECRET, ADMIN_API_KEY and WEBHOOK_SECRET are required');
  }
  if (jwtSecret.length < 32 || adminApiKey.length < 24 || webhookSecret.length < 24) {
    throw new Error('JWT_SECRET must be at least 32 characters; API keys at least 24');
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  return { databaseUrl, jwtSecret, adminApiKey, webhookSecret, port };
}
