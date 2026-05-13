import { NextResponse } from "next/server";

import type { ChatControlIntent } from "@/lib/types";
import { selectTrackImmediateAction } from "@/lib/orchestrator";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  let body: unknown = null;

  try {
    body = await request.json();
  } catch {
    body = null;
  }

  let action: ChatControlIntent = { type: "next" };

  if (isObject(body) && typeof body.action === "string") {
    if (body.action === "queue_index" && typeof body.queueIndex === "number") {
      action = { type: "queue_index", queueIndex: body.queueIndex };
    } else if (body.action === "track_query" && typeof body.query === "string") {
      action = { type: "track_query", query: body.query };
    } else {
      action = { type: "next" };
    }
  }

  const message = isObject(body) && typeof body.message === "string" ? body.message.trim() : undefined;
  const persistUserTurn = isObject(body) && body.persistUserTurn === true;
  const payload = await selectTrackImmediateAction(action, {
    message,
    persistUserTurn
  });
  return NextResponse.json(payload);
}
