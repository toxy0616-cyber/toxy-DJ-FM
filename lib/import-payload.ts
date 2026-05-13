import type { ListeningRecord, TasteImportPayload } from "@/lib/types";

type JsonObject = Record<string, unknown>;

const QQMUSIC_PLATFORM = "qqmusic";

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "n"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

function pickFromSources<T>(sources: JsonObject[], picker: (source: JsonObject) => T | undefined) {
  for (const source of sources) {
    const value = picker(source);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function pickString(sources: JsonObject[], keys: string[]) {
  return pickFromSources(sources, (source) => {
    for (const key of keys) {
      const value = asString(source[key]);
      if (value) {
        return value;
      }
    }

    return undefined;
  });
}

function pickNumber(sources: JsonObject[], keys: string[]) {
  return pickFromSources(sources, (source) => {
    for (const key of keys) {
      const value = asNumber(source[key]);
      if (value !== undefined) {
        return value;
      }
    }

    return undefined;
  });
}

function pickBoolean(sources: JsonObject[], keys: string[]) {
  return pickFromSources(sources, (source) => {
    for (const key of keys) {
      const value = asBoolean(source[key]);
      if (value !== undefined) {
        return value;
      }
    }

    return undefined;
  });
}

function toIsoDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return toIsoDate(numeric);
    }

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  return undefined;
}

function extractStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (isObject(item)) {
          return asString(item.name) ?? asString(item.title) ?? asString(item.value) ?? [];
        }

        return [];
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[\/,|;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function looksLikeTrackRecord(value: unknown): value is JsonObject {
  if (!isObject(value)) {
    return false;
  }

  const keys = [
    "title",
    "name",
    "songname",
    "songName",
    "artist",
    "artists",
    "singer",
    "singerName",
    "track_info",
    "songInfo"
  ];

  return keys.some((key) => key in value);
}

function collectNestedSources(record: JsonObject) {
  const nestedKeys = ["songInfo", "songinfo", "track_info", "trackInfo", "musicData", "song", "track"];
  const sources = [record];

  for (const key of nestedKeys) {
    const nested = record[key];
    if (isObject(nested)) {
      sources.push(nested);
    }
  }

  return sources;
}

function pickArtistName(sources: JsonObject[]) {
  const direct = pickString(sources, ["artist", "artistName", "artist_name", "singername", "singerName"]);
  if (direct) {
    return direct;
  }

  return pickFromSources(sources, (source) => {
    const candidates = [source.singer, source.singers, source.artists, source.artist_list];
    for (const candidate of candidates) {
      const names = extractStringList(candidate);
      if (names.length > 0) {
        return names.join(", ");
      }
    }

    return undefined;
  });
}

function pickPlayedAt(sources: JsonObject[]) {
  return pickFromSources(sources, (source) => {
    const keys = ["playedAt", "played_at", "listenTime", "playTime", "createTime", "timestamp", "time", "date"];
    for (const key of keys) {
      const value = toIsoDate(source[key]);
      if (value) {
        return value;
      }
    }

    return undefined;
  });
}

function pickCoverUrl(sources: JsonObject[]) {
  const direct = pickString(sources, ["coverUrl", "cover", "pic", "picUrl", "albumpic_big", "albumpic"]);
  if (direct) {
    return direct;
  }

  const mid = pickString(sources, ["albummid", "albumMid"]);
  if (mid) {
    return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`;
  }

  return undefined;
}

function pickReleaseYear(sources: JsonObject[]) {
  const direct = pickNumber(sources, ["releaseYear", "year", "publishYear", "pubYear"]);
  if (direct !== undefined) {
    return direct;
  }

  const dateValue = pickString(sources, ["pubtime", "publishTime", "releaseDate", "time_public"]);
  if (!dateValue) {
    return undefined;
  }

  const match = dateValue.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function pickDurationMs(sources: JsonObject[]) {
  const value = pickNumber(sources, ["durationMs", "duration", "interval"]);
  if (value === undefined) {
    return undefined;
  }

  return value < 1000 ? value * 1000 : value;
}

function normalizeTrackRecord(record: JsonObject, fallbackPlatform: string): ListeningRecord | null {
  const sources = collectNestedSources(record);
  const title = pickString(sources, ["title", "songname", "songName", "name"]);
  const artist = pickArtistName(sources);

  if (!title || !artist) {
    return null;
  }

  const genres = pickFromSources(sources, (source) => {
    const list = [
      ...extractStringList(source.genres),
      ...extractStringList(source.genre),
      ...extractStringList(source.style),
      ...extractStringList(source.styles)
    ];

    return list.length > 0 ? list : undefined;
  });

  const tags = pickFromSources(sources, (source) => {
    const list = [...extractStringList(source.tags), ...extractStringList(source.labels), ...extractStringList(source.tag)];
    return list.length > 0 ? list : undefined;
  });

  return {
    title,
    artist,
    album: pickString(sources, ["album", "albumname", "albumName", "album_title"]),
    playedAt: pickPlayedAt(sources),
    durationMs: pickDurationMs(sources),
    playCount: pickNumber(sources, ["playCount", "playcount", "listenCount", "plays", "count"]),
    liked: pickBoolean(sources, ["liked", "isLiked", "favorite", "isFavorite", "fav", "is_fav"]),
    skipped: pickBoolean(sources, ["skipped", "skip", "isSkip"]),
    releaseYear: pickReleaseYear(sources),
    genres,
    tags,
    energy: pickString(sources, ["energy"]) as ListeningRecord["energy"] | undefined,
    mood: pickString(sources, ["mood"]),
    platform: pickString(sources, ["platform"]) ?? fallbackPlatform,
    sourceTrackId: pickString(sources, ["sourceTrackId", "track_id", "trackId", "songmid", "mid", "id"]),
    sourceMid: pickString(sources, ["sourceMid", "songmid", "mid"]),
    sourcePlaylistId: pickString(sources, ["sourcePlaylistId", "disstid", "tid", "dirid", "songlistId"]),
    coverUrl: pickCoverUrl(sources)
  };
}

function normalizeRecordList(records: unknown[], fallbackPlatform: string) {
  return records
    .filter(looksLikeTrackRecord)
    .map((record) => normalizeTrackRecord(record, fallbackPlatform))
    .filter((record): record is ListeningRecord => record !== null);
}

function findTrackArray(value: unknown, depth = 0): unknown[] | null {
  if (depth > 3) {
    return null;
  }

  if (Array.isArray(value)) {
    if (value.some(looksLikeTrackRecord)) {
      return value;
    }

    for (const item of value) {
      const found = findTrackArray(item, depth + 1);
      if (found) {
        return found;
      }
    }

    return null;
  }

  if (!isObject(value)) {
    return null;
  }

  const preferredKeys = [
    "listeningHistory",
    "songs",
    "songList",
    "songlist",
    "list",
    "items",
    "tracks",
    "tracklist",
    "playlist",
    "favorites",
    "likes",
    "recentPlay",
    "recentPlays",
    "playHistory",
    "data",
    "cdlist",
    "disslist"
  ];

  for (const key of preferredKeys) {
    const nested = value[key];
    const found = findTrackArray(nested, depth + 1);
    if (found) {
      return found;
    }
  }

  for (const nested of Object.values(value)) {
    const found = findTrackArray(nested, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

function extractDislikes(payload: JsonObject) {
  return extractStringList(payload.dislikes);
}

function normalizeGenericPayload(payload: JsonObject, platform: string): TasteImportPayload {
  const listeningHistoryRaw = Array.isArray(payload.listeningHistory) ? payload.listeningHistory : [];
  const listeningHistory = normalizeRecordList(listeningHistoryRaw, platform);

  return {
    platform,
    displayName: asString(payload.displayName),
    sourceName: asString(payload.sourceName),
    listeningHistory,
    favorites: Array.isArray(payload.favorites) ? normalizeRecordList(payload.favorites, platform) : undefined,
    dislikes: extractDislikes(payload)
  };
}

export function normalizeQqMusicPayload(payload: JsonObject): TasteImportPayload {
  const normalized = normalizeGenericPayload(payload, QQMUSIC_PLATFORM);
  if (normalized.listeningHistory.length > 0) {
    return {
      ...normalized,
      displayName:
        normalized.displayName ??
        asString(payload.nick) ??
        asString(payload.nickname) ??
        (isObject(payload.user) ? asString(payload.user.nickname) : undefined),
      sourceName: normalized.sourceName ?? "qqmusic-import"
    };
  }

  const candidateTracks = findTrackArray(payload) ?? [];
  return {
    platform: QQMUSIC_PLATFORM,
    displayName:
      asString(payload.displayName) ??
      asString(payload.nick) ??
      asString(payload.nickname) ??
      (isObject(payload.user) ? asString(payload.user.nickname) : undefined),
    sourceName: asString(payload.sourceName) ?? "qqmusic-import",
    listeningHistory: normalizeRecordList(candidateTracks, QQMUSIC_PLATFORM),
    dislikes: extractDislikes(payload)
  };
}

export function normalizeTasteImportPayload(input: unknown): TasteImportPayload {
  if (!isObject(input)) {
    throw new Error("payload must be a JSON object");
  }

  const platform = asString(input.platform)?.toLowerCase();
  if (!platform) {
    throw new Error("platform is required");
  }

  const normalized = platform === QQMUSIC_PLATFORM ? normalizeQqMusicPayload(input) : normalizeGenericPayload(input, platform);

  if (normalized.listeningHistory.length === 0) {
    throw new Error("listeningHistory must not be empty");
  }

  return normalized;
}
