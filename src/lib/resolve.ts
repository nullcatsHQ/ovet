import { OvetError } from "./types";
import { ERROR_CODES, DEFAULTS } from "./constants";

export type ResolvedInput =
  | { type: "channelId"; value: string }
  | { type: "handle"; value: string }
  | { type: "username"; value: string };

const NON_CHANNEL_PATH_SEGMENTS = new Set([
  "watch",
  "shorts",
  "playlist",
  "results",
  "feed",
  "hashtag",
  "embed",
  "live",
  "post",
]);

export function resolveChannelInput(raw: string): ResolvedInput {
  const input = raw.trim();

  if (!input) {
    throw new OvetError("Channel handle, URL, or ID is required", 400, ERROR_CODES.INVALID_INPUT);
  }

  if (input.length > DEFAULTS.MAX_HANDLE_LENGTH) {
    throw new OvetError("Channel input is too long", 400, ERROR_CODES.INVALID_INPUT);
  }

  if (input.includes("youtube.com") || input.includes("youtu.be")) {
    let url: URL;
    try {
      url = new URL(input.startsWith("http") ? input : `https://${input}`);
    } catch {
      throw new OvetError("Could not parse the provided URL", 400, ERROR_CODES.INVALID_INPUT);
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const first = parts[0]?.toLowerCase();

    if (first && NON_CHANNEL_PATH_SEGMENTS.has(first)) {
      throw new OvetError(
        `This looks like a video/playlist URL, not a channel URL: /${first}/...`,
        400,
        ERROR_CODES.NOT_A_CHANNEL_URL
      );
    }

    if (first === "channel" && parts[1]) {
      return { type: "channelId", value: parts[1] };
    }
    if (first?.startsWith("@")) {
      return { type: "handle", value: first.slice(1) };
    }
    if ((first === "c" || first === "user") && parts[1]) {
      return { type: "username", value: parts[1] };
    }
    if (first) {
      return { type: "username", value: first };
    }

    throw new OvetError("Could not extract a channel from this URL", 400, ERROR_CODES.INVALID_INPUT);
  }

  if (/^UC[A-Za-z0-9_-]{22}$/.test(input)) {
    return { type: "channelId", value: input };
  }

  if (input.startsWith("@")) {
    const handle = input.slice(1);
    if (!handle) {
      throw new OvetError("Channel handle is empty", 400, ERROR_CODES.INVALID_INPUT);
    }
    return { type: "handle", value: handle };
  }

  return { type: "handle", value: input };
}
