/**
 * @fileoverview Server configuration for the Filing Fee MCP server.
 * Reads environment variables for SEC EDGAR access and transport settings.
 * @module config/server-config
 */

import { z } from "zod";

const ServerConfigSchema = z.object({
  userAgent: z.string().min(1, "EDGAR_USER_AGENT is required (format: 'AppName contact@email.com')"),
  rateLimitRps: z.coerce.number().int().min(1).max(10).default(10),
  tickerCacheTtl: z.coerce.number().int().min(60).default(3600),
  transportType: z.enum(["stdio", "http"]).default("stdio"),
  httpPort: z.coerce.number().int().min(1).max(65535).default(3010),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function loadConfig(): ServerConfig {
  return ServerConfigSchema.parse({
    userAgent: process.env.EDGAR_USER_AGENT,
    rateLimitRps: process.env.EDGAR_RATE_LIMIT_RPS,
    tickerCacheTtl: process.env.EDGAR_TICKER_CACHE_TTL,
    transportType: process.env.MCP_TRANSPORT_TYPE,
    httpPort: process.env.MCP_HTTP_PORT,
  });
}
