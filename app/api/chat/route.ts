import { NextResponse } from "next/server";

import { handleChat } from "@/lib/orchestrator";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      latitude?: number;
      longitude?: number;
    };
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const payload = await handleChat(message, {
      latitude: typeof body.latitude === "number" ? body.latitude : undefined,
      longitude: typeof body.longitude === "number" ? body.longitude : undefined
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Chat service failed.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
