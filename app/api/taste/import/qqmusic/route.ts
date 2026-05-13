import { NextResponse } from "next/server";

import { buildQqMusicImportPayload, buildQqMusicImportPayloadFromWeb } from "@/lib/qqmusic-api";
import { normalizeTasteImportPayload } from "@/lib/import-payload";
import { buildPlayableLibrarySnapshot, savePlayableLibrary } from "@/lib/music-library";
import { getDailyPlaylist } from "@/lib/orchestrator";
import { createInitialRadioState, saveRadioState } from "@/lib/radio-state";
import { mergeTasteImportPayload } from "@/lib/taste-merge";
import { generateTasteArtifacts } from "@/lib/taste-source";
import { saveGeneratedTasteArtifacts } from "@/lib/taste-store";

function asString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}

function isLocalBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const baseUrl = asString((body as { baseUrl?: unknown }).baseUrl) ?? "http://localhost:3300";
  const qqNumber = asString((body as { qqNumber?: unknown; id?: unknown; uin?: unknown }).qqNumber)
    ?? asString((body as { id?: unknown }).id)
    ?? asString((body as { uin?: unknown }).uin);
  const cookie = asString((body as { cookie?: unknown }).cookie);

  if (!qqNumber) {
    return NextResponse.json({ error: "qqNumber is required" }, { status: 400 });
  }

  try {
    let payload;

    if (isLocalBaseUrl(baseUrl)) {
      try {
        payload = await buildQqMusicImportPayload({
          baseUrl,
          qqNumber,
          cookie
        });
      } catch {
        payload = await buildQqMusicImportPayloadFromWeb({
          qqNumber,
          cookie
        });
      }
    } else {
      payload = await buildQqMusicImportPayloadFromWeb({
        qqNumber,
        cookie
      });
    }

    const normalized = normalizeTasteImportPayload(payload);
    const mergedPayload = await mergeTasteImportPayload(normalized);
    const artifacts = generateTasteArtifacts(mergedPayload);
    await saveGeneratedTasteArtifacts(artifacts);
    const playableLibrary = buildPlayableLibrarySnapshot(normalized, cookie);
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
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "QQMusicApi import failed" },
      { status: 400 }
    );
  }
}
