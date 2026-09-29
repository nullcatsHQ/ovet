import { createMiddleware } from "hono/factory";
import { OvetError } from "../lib/types";
import type { Env } from "../lib/types";
import { ERROR_CODES } from "../lib/constants";

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.byteLength !== bBytes.byteLength) {
    return !crypto.subtle.timingSafeEqual(aBytes, aBytes);
  }

  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

export const refreshAuthMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const configuredKey = c.env.REFRESH_API_KEY;

  if (!configuredKey) {
    await next();
    return;
  }

  const providedKey = c.req.header("x-api-key") ?? "";

  if (!providedKey || !timingSafeEqual(providedKey, configuredKey)) {
    throw new OvetError("Missing or invalid API key for this endpoint", 401, ERROR_CODES.UNAUTHORIZED);
  }

  await next();
});
