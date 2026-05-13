import { NextResponse } from "next/server";

import { readTrackLyrics } from "@/lib/local-lyrics";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider")?.trim() ?? "";
  const providerTrackId = searchParams.get("providerTrackId")?.trim() ?? "";

  if (!provider || !providerTrackId) {
    return NextResponse.json(
      {
        lines: [],
        source: "none"
      },
      { status: 200 }
    );
  }

  const payload = await readTrackLyrics(provider, providerTrackId);
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
