import { NextResponse } from "next/server";

import { getDailyPlaylist } from "@/lib/orchestrator";

export async function GET() {
  const playlist = await getDailyPlaylist();

  return NextResponse.json({
    playlist,
    note: "Weather and schedule hooks are reserved for phase two."
  });
}

