import { NextResponse } from "next/server";

import { syncLocalLibraryCovers, type LocalCoverSyncMode } from "@/lib/local-cover-art";
import { buildLocalMusicImport } from "@/lib/local-music";
import { savePlayableLibrary } from "@/lib/music-library";
import { getDailyPlaylist } from "@/lib/orchestrator";
import { createInitialRadioState, saveRadioState } from "@/lib/radio-state";
import { generateTasteArtifacts } from "@/lib/taste-source";
import { saveGeneratedTasteArtifacts } from "@/lib/taste-store";

function asString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}

function asCoverMode(value: unknown): LocalCoverSyncMode {
  if (value === "none" || value === "local" || value === "internet") {
    return value;
  }

  return "local";
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const folderPath = asString((body as { folderPath?: unknown })?.folderPath);
  const coverMode = asCoverMode((body as { coverMode?: unknown })?.coverMode);
  if (!folderPath) {
    return NextResponse.json({ error: "folderPath is required" }, { status: 400 });
  }

  try {
    const { payload, library } = await buildLocalMusicImport(folderPath);
    const artifacts = generateTasteArtifacts(payload);

    await savePlayableLibrary(library);
    const coverSummary = await syncLocalLibraryCovers(library, { mode: coverMode });
    await savePlayableLibrary(library);
    await saveGeneratedTasteArtifacts(artifacts);
    await saveRadioState(await createInitialRadioState(artifacts.profile));

    const dailyPlaylist = await getDailyPlaylist();

    return NextResponse.json({
      profile: artifacts.profile,
      snapshot: artifacts.snapshot,
      dailyPlaylist,
      importedTrackCount: library.tracks.length,
      rootPath: library.rootPath,
      coverMode,
      coverSummary
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Local music import failed" },
      { status: 400 }
    );
  }
}
