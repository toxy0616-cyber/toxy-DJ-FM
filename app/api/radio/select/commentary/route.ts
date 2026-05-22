import { NextResponse } from "next/server";

import { createTrackCommentaryAction } from "@/lib/orchestrator";
import type { ChatControlIntent } from "@/lib/types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    let body: unknown = null;

    try {
      body = await request.json();
    } catch {
      body = null;
    }

    let action: ChatControlIntent = { type: "next" };
    let expectedTrackId: string | undefined;
    let switchToken: string | undefined;
    let message: string | undefined;

    if (isObject(body) && typeof body.action === "string") {
      if (body.action === "queue_index" && typeof body.queueIndex === "number") {
        action = { type: "queue_index", queueIndex: body.queueIndex };
      } else if (body.action === "track_query" && typeof body.query === "string") {
        action = { type: "track_query", query: body.query };
      } else {
        action = { type: "next" };
      }

      if (typeof body.expectedTrackId === "string" && body.expectedTrackId.trim()) {
        expectedTrackId = body.expectedTrackId.trim();
      }

      if (typeof body.switchToken === "string" && body.switchToken.trim()) {
        switchToken = body.switchToken.trim();
      }

      if (typeof body.message === "string" && body.message.trim()) {
        message = body.message.trim();
      }
    }

    const payload = await createTrackCommentaryAction(action, {
      expectedTrackId,
      switchToken,
      message
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Track commentary failed.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
