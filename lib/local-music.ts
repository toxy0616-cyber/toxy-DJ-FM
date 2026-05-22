import { createHash } from "node:crypto";
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ListeningRecord, PlayableLibrarySnapshot, PlayableTrackSnapshot, TasteImportPayload } from "@/lib/types";
import { slugify, uniqueStrings } from "@/lib/utils";

export interface TrackMetadataEnriched {
  genres: string[];
  tags: string[];
  description: string;
  era?: string;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac"]);
const SUPPORTED_IMPORT_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ".mgg"]);

function isAudioFile(filePath: string) {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isSupportedImportFile(filePath: string) {
  return SUPPORTED_IMPORT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function inferEnergyFromName(name: string): PlayableTrackSnapshot["energy"] {
  const lower = name.toLowerCase();

  if (/(live|remix|club|edm|drum|bass|rock)/.test(lower)) {
    return "high";
  }

  if (/(focus|study|mix|instrumental|lofi|lo-fi)/.test(lower)) {
    return "medium";
  }

  return "low";
}

function inferMoodFromPath(filePath: string) {
  const lower = filePath.toLowerCase();

  if (/(rain|night|ambient|sleep)/.test(lower)) {
    return "sad";
  }

  if (/(focus|study|work|instrumental|lofi|lo-fi)/.test(lower)) {
    return "focused";
  }

  if (/(love|romance|citypop|city-pop)/.test(lower)) {
    return "happy";
  }

  if (/(rock|punk|metal|rage)/.test(lower)) {
    return "energetic";
  }

  return "calm";
}

function splitNameParts(baseName: string) {
  const cleaned = baseName.replace(/\[[^\]]*]|\([^\)]*\)/g, "").replace(/\s+/g, " ").trim();
  const separators = [" - ", " — ", " – ", "_-_"];

  for (const separator of separators) {
    const parts = cleaned.split(separator).map((item) => item.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        artist: parts[0],
        title: parts.slice(1).join(" - ")
      };
    }
  }

  return {
    artist: "Local Library",
    title: cleaned || baseName
  };
}

async function walkAudioFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkAudioFiles(fullPath));
      continue;
    }

    if (entry.isFile() && isSupportedImportFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function buildTags(filePath: string, rootPath: string) {
  const relative = path.relative(rootPath, filePath);
  const folders = path.dirname(relative).split(path.sep).filter((item) => item && item !== ".");
  return uniqueStrings(folders.map((item) => item.toLowerCase().replace(/\s+/g, "-"))).slice(0, 6);
}

function buildLocalTrackId(relativePath: string, fallbackName: string) {
  const readable = slugify(relativePath) || slugify(fallbackName) || "local-track";
  const digest = createHash("sha1").update(relativePath.toLowerCase()).digest("hex").slice(0, 12);
  return `${readable}-${digest}`;
}

export async function buildLocalMusicImport(rootPath: string) {
  const resolvedRoot = path.resolve(rootPath);
  const rootStats = await stat(resolvedRoot);
  if (!rootStats.isDirectory()) {
    throw new Error("The provided path is not a folder.");
  }

  const audioFiles = await walkAudioFiles(resolvedRoot);
  if (audioFiles.length === 0) {
    throw new Error("No supported audio files were found in that folder.");
  }

  const importedAt = new Date().toISOString();
  const listeningHistory: ListeningRecord[] = [];
  const tracks: PlayableTrackSnapshot[] = [];

  for (const filePath of audioFiles) {
    const parsed = path.parse(filePath);
    const nameParts = splitNameParts(parsed.name);
    const tags = buildTags(filePath, resolvedRoot);
    const relativePath = path.relative(resolvedRoot, filePath);
    const providerTrackId = buildLocalTrackId(relativePath, parsed.base);
    const energy = inferEnergyFromName(parsed.name);
    const mood = inferMoodFromPath(filePath);

    listeningHistory.push({
      title: nameParts.title,
      artist: nameParts.artist,
      album: path.basename(path.dirname(filePath)) || "Local Library",
      platform: "local",
      sourceTrackId: providerTrackId,
      tags
    });

    tracks.push({
      provider: "local",
      providerTrackId,
      localFilePath: filePath,
      mimeType: undefined,
      title: nameParts.title,
      artist: nameParts.artist,
      album: path.basename(path.dirname(filePath)) || "Local Library",
      durationMs: undefined,
      coverUrl: undefined,
      energy,
      mood,
      tags,
      searchableText: `${nameParts.title} ${nameParts.artist} ${relativePath} ${tags.join(" ")}`.toLowerCase(),
      importedAt,
      playable: isAudioFile(filePath)
    });
  }

  const payload: TasteImportPayload = {
    platform: "local",
    displayName: path.basename(resolvedRoot),
    sourceName: "local-files",
    listeningHistory
  };

  const library: PlayableLibrarySnapshot = {
    provider: "local",
    importedAt,
    displayName: path.basename(resolvedRoot),
    sourceName: "local-files",
    rootPath: resolvedRoot,
    tracks
  };

  return {
    payload,
    library
  };
}

const LASTFM_CACHE_FILE = path.join(process.cwd(), ".data", "lastfm-cache.json");
const LASTFM_FETCH_TIMEOUT_MS = 6000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LASTFM_FETCH_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function loadLastfmCache(): Promise<Map<string, TrackMetadataEnriched>> {
  try {
    const data = await readFile(LASTFM_CACHE_FILE, "utf-8");
    const entries = JSON.parse(data) as Array<[string, TrackMetadataEnriched]>;
    return new Map(entries);
  } catch {
    return new Map();
  }
}

async function saveLastfmCache(cache: Map<string, TrackMetadataEnriched>): Promise<void> {
  const entries = Array.from(cache.entries());
  await writeFile(LASTFM_CACHE_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

/**
 * Enrich a single track with Last.fm metadata (genres, tags, description)
 */
export async function enrichTrackWithLastfm(
  track: PlayableTrackSnapshot,
  apiKey: string = process.env.LASTFM_API_KEY || ""
): Promise<TrackMetadataEnriched> {
  if (!apiKey) {
    return {
      genres: [],
      tags: [],
      description: `${track.title} by ${track.artist}`
    };
  }

  const cacheKey = `${track.artist}::${track.title}`.toLowerCase();

  // Check cache first
  const cache = await loadLastfmCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Call Last.fm API
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.searchParams.set("method", "track.getInfo");
    url.searchParams.set("artist", track.artist);
    url.searchParams.set("track", track.title);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("format", "json");

    const response = await fetchWithTimeout(url.toString());
    if (!response.ok) {
      throw new Error(`Last.fm API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      track?: {
        toptags?: { tag: Array<{ name: string; count: number }> };
        wiki?: { summary?: string };
      };
      error?: number;
    };

    if (data.error) {
      console.warn(`Last.fm API error for ${track.artist} - ${track.title}: ${data.error}`);
      throw new Error("Track not found");
    }

    const trackData = data.track;
    const genres: string[] = [];
    const tags: string[] = [];
    let description = `${track.title} by ${track.artist}`;

    if (trackData?.toptags?.tag) {
      const topTags = trackData.toptags.tag.slice(0, 8);
      for (const tag of topTags) {
        if (tag.count > 10) {
          genres.push(tag.name);
        }
        tags.push(tag.name);
      }
    }

    if (trackData?.wiki?.summary) {
      description = trackData.wiki.summary.replace(/<[^>]*>/g, "").slice(0, 500);
    }

    const enriched: TrackMetadataEnriched = {
      genres,
      tags: tags.slice(0, 10),
      description
    };

    // Save to cache
    cache.set(cacheKey, enriched);
    await saveLastfmCache(cache);

    return enriched;
  } catch (error) {
    console.warn(
      `Failed to enrich track ${track.artist} - ${track.title}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Return minimal enriched data on error
    return {
      genres: [],
      tags: track.tags || [],
      description: `${track.title} by ${track.artist}`
    };
  }
}

/**
 * Enrich all tracks in a library with Last.fm metadata
 */
export async function enrichLocalLibraryWithLastfm(
  library: PlayableLibrarySnapshot,
  apiKey: string = process.env.LASTFM_API_KEY || ""
): Promise<Map<string, TrackMetadataEnriched>> {
  const enrichedMap = new Map<string, TrackMetadataEnriched>();

  for (let i = 0; i < library.tracks.length; i++) {
    const track = library.tracks[i];

    const enriched = await enrichTrackWithLastfm(track, apiKey);
    enrichedMap.set(track.providerTrackId, enriched);

    // Add delay to avoid API rate limiting
    if ((i + 1) % 10 === 0) {
      console.log(`Enriched ${i + 1}/${library.tracks.length} tracks`);
      // Wait 2 seconds between batches of 10
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log(`Enriched ${library.tracks.length} tracks with Last.fm metadata`);
  return enrichedMap;
}
