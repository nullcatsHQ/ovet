import type { Db } from "../db/client";
import { requestLog } from "../db/schema";

export async function logRequest(
  db: Db,
  path: string,
  channelQuery: string | null,
  method: string,
  status: number,
  durationMs: number
) {
  try {
    await db.insert(requestLog).values({
      path,
      channelQuery,
      method,
      status,
      durationMs,
    });
  } catch (err) {
    console.error("Failed to write request log:", err);
  }
}
