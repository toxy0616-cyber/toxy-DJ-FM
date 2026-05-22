import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { createSafeAudioStream } from "@/lib/audio";
import { readPlayableLibrary } from "@/lib/music-library";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg"
};

function mimeTypeForPath(filePath: string) {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const library = await readPlayableLibrary();

    if (!library || library.provider !== "local") {
      return NextResponse.json({ error: "Local music library is not loaded." }, { status: 404 });
    }

    const track = library.tracks.find((item) => item.provider === "local" && item.providerTrackId === id);
    if (!track?.localFilePath) {
      return NextResponse.json({ error: "Local audio file not found." }, { status: 404 });
    }

    const fileStats = await stat(track.localFilePath);
    const range = request.headers.get("range");
    const mimeType = track.mimeType ?? mimeTypeForPath(track.localFilePath);

    if (!range) {
      const stream = createReadStream(track.localFilePath);
      return new Response(createSafeAudioStream(stream, request.signal), {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(fileStats.size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store"
        }
      });
    }

    const [startRaw, endRaw] = range.replace(/bytes=/i, "").split("-");
    const start = Number(startRaw);
    const end = endRaw ? Number(endRaw) : fileStats.size - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= fileStats.size || start > end) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileStats.size}`
        }
      });
    }

    const stream = createReadStream(track.localFilePath, { start, end });

    return new Response(createSafeAudioStream(stream, request.signal), {
      status: 206,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${fileStats.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to stream local audio.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
