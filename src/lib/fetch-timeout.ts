import { OvetError } from "./types";
import { ERROR_CODES, DEFAULTS } from "./constants";

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULTS.UPSTREAM_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new OvetError(
        `Upstream request timed out after ${timeoutMs}ms`,
        504,
        ERROR_CODES.UPSTREAM_TIMEOUT
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
