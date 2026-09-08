import { z } from "zod";

export const ServerConfigSchema = z.object({
  host: z.string().trim().min(1, "Host cannot be empty").default("0.0.0.0"),
  port: z.coerce
    .number()
    .int("Port must be an integer")
    .min(1, "Port must be at least 1")
    .max(65535, "Port must be at most 65535")
    .default(3000),
  dbPath: z
    .string()
    .trim()
    .min(1, "Database path cannot be empty")
    .default("./data/interests.sqlite"),
  /**
   * Whether to send cookies with Secure attribute.
   * Default is false for the local-first LAN V1 runtime.
   * A future HTTPS deployment must enable Secure cookies.
   */
  cookieSecure: z.boolean().default(false),
  rateLimitDisabled: z.boolean().default(false),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function parseServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  const raw: Record<string, unknown> = {};

  const hostVal = env.INTERESTS_HOST ?? env.FINANCE_GAME_HOST;
  if (hostVal !== undefined) {
    raw.host = hostVal;
  }
  const portVal = env.INTERESTS_PORT ?? env.FINANCE_GAME_PORT;
  if (portVal !== undefined) {
    raw.port = portVal;
  }
  const dbPathVal = env.INTERESTS_DB_PATH ?? env.FINANCE_GAME_DB_PATH;
  if (dbPathVal !== undefined) {
    raw.dbPath = dbPathVal;
  }
  const cookieSecureVal =
    env.INTERESTS_COOKIE_SECURE ?? env.FINANCE_GAME_COOKIE_SECURE;
  if (cookieSecureVal !== undefined) {
    const rawVal = cookieSecureVal.trim().toLowerCase();
    if (rawVal === "true") {
      raw.cookieSecure = true;
    } else if (rawVal === "false") {
      raw.cookieSecure = false;
    } else {
      throw new Error(
        "Invalid server configuration: cookieSecure must be 'true' or 'false'",
      );
    }
  }
  const rateLimitDisabledVal =
    env.INTERESTS_RATE_LIMIT_DISABLED ?? env.FINANCE_GAME_RATE_LIMIT_DISABLED;
  if (rateLimitDisabledVal !== undefined) {
    const rawVal = rateLimitDisabledVal.trim().toLowerCase();
    if (rawVal === "true") {
      raw.rateLimitDisabled = true;
    } else if (rawVal === "false") {
      raw.rateLimitDisabled = false;
    } else {
      throw new Error(
        "Invalid server configuration: rateLimitDisabled must be 'true' or 'false'",
      );
    }
  }

  const result = ServerConfigSchema.safeParse(raw);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${errorDetails}`);
  }

  return result.data;
}
