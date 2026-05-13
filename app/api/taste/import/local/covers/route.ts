import { NextResponse } from "next/server";

import { syncLocalLibraryCovers } from "@/lib/local-cover-art";
import { readPlayableLibrary, savePlayableLibrary } from "@/lib/music-library";

function asPositiveInteger(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return fallback;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const startIndex = asPositiveInteger((body as { startIndex?: unknown })?.startIndex, 0);
  const batchSize = asPositiveInteger((body as { batchSize?: unknown })?.batchSize, 100);
  const library = await readPlayableLibrary();

  if (!library || library.provider !== "local") {
    return NextResponse.json({ error: "Local music library is not loaded." }, { status: 404 });
  }

  const summary = await syncLocalLibraryCovers(library, {
    mode: "internet",
    startIndex,
    maxTracks: batchSize
  });

  await savePlayableLibrary(library);

  const coveredTracks = library.tracks.filter((track) => typeof track.coverUrl === "string" && track.coverUrl.trim().length > 0).length;

  return NextResponse.json({
    startIndex,
    batchSize,
    coveredTracks,
    totalTracks: library.tracks.length,
    summary
  });
}
