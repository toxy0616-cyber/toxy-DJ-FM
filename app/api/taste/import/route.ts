import { NextResponse } from "next/server";

import { normalizeTasteImportPayload } from "@/lib/import-payload";
import { buildPlayableLibrarySnapshot, savePlayableLibrary } from "@/lib/music-library";
import { getDailyPlaylist } from "@/lib/orchestrator";
import { createInitialRadioState, saveRadioState } from "@/lib/radio-state";
import { mergeTasteImportPayload } from "@/lib/taste-merge";
import { generateTasteArtifacts } from "@/lib/taste-source";
import { saveGeneratedTasteArtifacts } from "@/lib/taste-store";

export async function POST(request: Request) {
  let rawBody: unknown;
  let payload;

  try {
    rawBody = await request.json();
    payload = normalizeTasteImportPayload(rawBody);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid taste import payload" },
      { status: 400 }
    );
  }

  const mergedPayload = await mergeTasteImportPayload({
    platform: payload.platform,
    displayName: payload.displayName,
    sourceName: payload.sourceName,
    listeningHistory: payload.listeningHistory,
    favorites: payload.favorites,
    dislikes: payload.dislikes
  });
  const artifacts = generateTasteArtifacts(mergedPayload);

  await saveGeneratedTasteArtifacts(artifacts);
  const sessionCookie =
    typeof rawBody === "object" && rawBody !== null && "cookie" in rawBody && typeof rawBody.cookie === "string"
      ? rawBody.cookie.trim() || undefined
      : undefined;
  const playableLibrary = buildPlayableLibrarySnapshot(payload, sessionCookie);
  if (playableLibrary) {
    await savePlayableLibrary(playableLibrary);
  }
  await saveRadioState(await createInitialRadioState(artifacts.profile));
  const dailyPlaylist = await getDailyPlaylist();

  return NextResponse.json({
    profile: artifacts.profile,
    snapshot: artifacts.snapshot,
    dailyPlaylist
  });
}
