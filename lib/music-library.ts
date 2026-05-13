import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PlayableLibrarySnapshot, PlayableTrackSnapshot, TasteImportPayload, TrackCandidate } from "@/lib/types";
import { makeId, slugify, stripUtf8Bom, uniqueStrings } from "@/lib/utils";

const DATA_DIR = path.join(process.cwd(), ".data");
const PLAYABLE_LIBRARY_FILE = path.join(DATA_DIR, "playable-library.json");
const EMPTY_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export function resolveTrackCoverUrl(track: {
  provider: "demo" | "local" | "qqmusic";
  providerTrackId: string;
  coverUrl?: string;
}) {
  if (track.coverUrl && track.coverUrl !== EMPTY_GIF) {
    return track.coverUrl;
  }

  if (track.provider === "local") {
    return `/api/cover/local/${encodeURIComponent(track.providerTrackId)}`;
  }

  return EMPTY_GIF;
}

function clampEnergy(value?: string): PlayableTrackSnapshot["energy"] {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  return "medium";
}

function inferMoodFromTags(tags: string[]) {
  const haystack = tags.join(" ").toLowerCase();

  if (/(rain|gentle|soft|late-night|ambient)/.test(haystack)) {
    return "rainy";
  }

  if (/(focus|study|code|vinyl|instrumental)/.test(haystack)) {
    return "locked-in";
  }

  if (/(romance|romantic|city-pop|glow|soft-focus)/.test(haystack)) {
    return "romantic";
  }

  if (/(defiant|rage|punk|bass|drums|rock)/.test(haystack)) {
    return "defiant";
  }

  return "drained";
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) {
    return undefined;
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function toTrackId(track: Pick<PlayableTrackSnapshot, "provider" | "providerTrackId" | "title" | "artist">) {
  return slugify(`${track.provider}-${track.providerTrackId}-${track.title}-${track.artist}`) || makeId(track.provider);
}

function streamUrlForTrack(track: PlayableTrackSnapshot) {
  if (track.provider === "local") {
    return `/api/audio/local/${encodeURIComponent(track.providerTrackId)}`;
  }

  return `/api/audio/qq/${encodeURIComponent(track.providerTrackId)}`;
}

export function toTrackCandidate(track: PlayableTrackSnapshot): TrackCandidate {
  return {
    id: toTrackId(track),
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationLabel: formatDuration(track.durationMs),
    durationMs: track.durationMs,
    mood: track.mood,
    energy: track.energy,
    tags: track.tags,
    coverUrl: resolveTrackCoverUrl(track),
    streamUrl: streamUrlForTrack(track),
    provider: track.provider,
    providerTrackId: track.providerTrackId,
    playable: track.playable
  };
}

export function buildPlayableLibrarySnapshot(payload: TasteImportPayload, sessionCookie?: string): PlayableLibrarySnapshot | null {
  if (payload.platform !== "qqmusic") {
    return null;
  }

  const importedAt = new Date().toISOString();
  const deduped = new Map<string, PlayableTrackSnapshot>();

  for (const record of payload.listeningHistory) {
    const providerTrackId = record.sourceTrackId ?? record.sourceMid;
    if (!providerTrackId) {
      continue;
    }

    const title = record.title?.trim();
    const artist = record.artist?.trim();
    if (!title || !artist) {
      continue;
    }

    const tags = uniqueStrings([...(record.tags ?? []), ...(record.genres ?? [])]);
    const snapshot: PlayableTrackSnapshot = {
      provider: "qqmusic",
      providerTrackId,
      sourceMid: record.sourceMid,
      sourcePlaylistId: record.sourcePlaylistId,
      title,
      artist,
      album: record.album?.trim() || "QQ Music",
      durationMs: record.durationMs,
      coverUrl: record.coverUrl,
      energy: clampEnergy(record.energy),
      mood: record.mood?.trim() || inferMoodFromTags(tags),
      tags,
      searchableText: `${title} ${artist} ${record.album ?? ""} ${tags.join(" ")}`.toLowerCase(),
      importedAt,
      playable: true
    };

    deduped.set(providerTrackId, snapshot);
  }

  return {
    provider: "qqmusic",
    importedAt,
    displayName: payload.displayName,
    sourceName: payload.sourceName,
    sessionCookie,
    tracks: [...deduped.values()]
  };
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function savePlayableLibrary(snapshot: PlayableLibrarySnapshot) {
  await ensureDataDir();
  await writeFile(PLAYABLE_LIBRARY_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function readPlayableLibrary() {
  try {
    const raw = await readFile(PLAYABLE_LIBRARY_FILE, "utf8");
    return JSON.parse(stripUtf8Bom(raw)) as PlayableLibrarySnapshot;
  } catch {
    return null;
  }
}
