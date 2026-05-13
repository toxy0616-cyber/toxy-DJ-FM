import { NextResponse } from "next/server";

import { hasServerTtsConfig, synthesizeSpeech } from "@/lib/tts";

export async function GET() {
  return NextResponse.json({
    available: hasServerTtsConfig()
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();

  if (!text) {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }

  if (!hasServerTtsConfig()) {
    return NextResponse.json({ error: "Server TTS is not configured." }, { status: 503 });
  }

  const audio = await synthesizeSpeech(text);
  if (!audio) {
    return NextResponse.json({ error: "Server TTS is not configured." }, { status: 503 });
  }

  return new NextResponse(audio.audioBuffer, {
    headers: {
      "Content-Type": audio.mimeType,
      "Cache-Control": "no-store"
    }
  });
}
