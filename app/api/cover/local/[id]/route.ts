import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { buildGeneratedCover, findCachedCover, findSiblingCover, mimeTypeForImage } from "@/lib/local-cover-art";
import { readPlayableLibrary } from "@/lib/music-library";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const library = await readPlayableLibrary();

  if (!library || library.provider !== "local") {
    return NextResponse.json({ error: "Local music library is not loaded." }, { status: 404 });
  }

  const track = library.tracks.find((item) => item.provider === "local" && item.providerTrackId === id);
  if (!track?.localFilePath) {
    return NextResponse.json({ error: "Local track cover not found." }, { status: 404 });
  }

  const coverPath = (await findCachedCover(track.providerTrackId)) ?? (await findSiblingCover(track.localFilePath));
  if (coverPath) {
    const image = await readFile(coverPath);

    return new Response(image, {
      status: 200,
      headers: {
        "Content-Type": mimeTypeForImage(coverPath),
        "Cache-Control": "no-store"
      }
    });
  }

  if (track.coverUrl && /^https?:\/\//i.test(track.coverUrl)) {
    return NextResponse.redirect(track.coverUrl);
  }

  return new Response(buildGeneratedCover(track.title, track.artist), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
