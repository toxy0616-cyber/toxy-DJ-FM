import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PlayableLibrarySnapshot, PlayableTrackSnapshot } from "@/lib/types";
import { escapeSvg } from "@/lib/utils";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const CACHE_DIR = path.join(process.cwd(), ".data", "local-covers");
const COVER_BASENAMES = ["cover", "folder", "album", "front", "artwork"];
const GENERIC_ALBUM_NAMES = new Set(["music", "local-library", "local-library", "downloads", "songs", "audio"]);
const MUSICBRAINZ_USER_AGENT = "toxy/0.1.0 (https://localhost)";

let lastMusicBrainzRequestAt = 0;

type CoverSource = "local" | "itunes" | "musicbrainz";

interface CachedCoverManifest {
  fileName: string;
  savedAt: string;
  source: CoverSource;
  originalUrl?: string;
}

interface ITunesResult {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
}

interface MusicBrainzArtistCredit {
  name?: string;
  artist?: {
    name?: string;
  };
}

interface MusicBrainzRelease {
  id?: string;
  title?: string;
  "release-group"?: {
    id?: string;
    title?: string;
  };
}

interface MusicBrainzRecording {
  score?: number | string;
  title?: string;
  "artist-credit"?: MusicBrainzArtistCredit[];
  releases?: MusicBrainzRelease[];
}

interface RemoteCoverCandidate {
  imageUrl: string;
  source: CoverSource;
}

export type LocalCoverSyncMode = "none" | "local" | "internet";

export interface LocalCoverSyncSummary {
  totalTracks: number;
  scannedTracks: number;
  reusedCached: number;
  importedSibling: number;
  downloadedRemote: number;
  missing: number;
  failed: number;
}

function localCoverDir(trackId: string) {
  return path.join(CACHE_DIR, trackId);
}

function manifestPath(trackId: string) {
  return path.join(localCoverDir(trackId), "manifest.json");
}

function localCoverUrl(trackId: string) {
  return `/api/cover/local/${encodeURIComponent(trackId)}`;
}

function normalizeText(value?: string) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\[[^\]]*]|\([^\)]*\)/g, " ")
    .replace(/[_]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(value?: string) {
  return normalizeText(value).replace(/\s+/g, "");
}

function splitArtists(value?: string) {
  return normalizeText(value)
    .split(/\s*(?:,|\/|&|feat|featuring|ft|with|x)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function primaryArtist(value?: string) {
  return splitArtists(value)[0] ?? normalizeText(value);
}

function meaningfulAlbum(value?: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  return GENERIC_ALBUM_NAMES.has(normalized) ? "" : normalized;
}

function sharedArtistScore(left?: string, right?: string) {
  const leftTokens = splitArtists(left);
  const rightTokens = splitArtists(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftJoined = leftTokens.join(" ");
  const rightJoined = rightTokens.join(" ");
  if (leftJoined === rightJoined) {
    return 6;
  }

  if (leftJoined.includes(rightJoined) || rightJoined.includes(leftJoined)) {
    return 4;
  }

  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return Math.min(overlap * 2, 4);
}

function titleScore(left?: string, right?: string) {
  const leftCompact = normalizeCompact(left);
  const rightCompact = normalizeCompact(right);

  if (!leftCompact || !rightCompact) {
    return 0;
  }

  if (leftCompact === rightCompact) {
    return 8;
  }

  if (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact)) {
    return 5;
  }

  const leftWords = normalizeText(left).split(" ").filter(Boolean);
  const rightWords = normalizeText(right).split(" ").filter(Boolean);
  const overlap = leftWords.filter((word) => rightWords.includes(word)).length;
  return Math.min(overlap * 2, 4);
}

function trackMatchScore(track: Pick<PlayableTrackSnapshot, "title" | "artist" | "album">, candidate: {
  title?: string;
  artist?: string;
  album?: string;
}) {
  let score = titleScore(track.title, candidate.title) + sharedArtistScore(track.artist, candidate.artist);
  const trackAlbum = meaningfulAlbum(track.album);
  const candidateAlbum = meaningfulAlbum(candidate.album);

  if (trackAlbum && candidateAlbum) {
    if (trackAlbum === candidateAlbum) {
      score += 3;
    } else if (trackAlbum.includes(candidateAlbum) || candidateAlbum.includes(trackAlbum)) {
      score += 1;
    }
  }

  return score;
}

function extensionFromContentType(contentType?: string | null, fallbackUrl?: string) {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("png")) {
    return ".png";
  }

  if (normalized.includes("webp")) {
    return ".webp";
  }

  if (normalized.includes("gif")) {
    return ".gif";
  }

  const fallbackExtension = path.extname(new URL(fallbackUrl ?? "https://local.invalid/cover.jpg").pathname).toLowerCase();
  if (IMAGE_EXTENSIONS.has(fallbackExtension)) {
    return fallbackExtension;
  }

  return ".jpg";
}

export function mimeTypeForImage(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".gif") {
    return "image/gif";
  }

  return "image/jpeg";
}

async function readCachedManifest(trackId: string) {
  try {
    const raw = await readFile(manifestPath(trackId), "utf8");
    const parsed = JSON.parse(raw) as CachedCoverManifest;
    return parsed.fileName ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCachedManifest(trackId: string, manifest: CachedCoverManifest) {
  const trackDir = localCoverDir(trackId);
  await mkdir(trackDir, { recursive: true });
  await writeFile(manifestPath(trackId), JSON.stringify(manifest, null, 2), "utf8");
}

async function saveCachedCover(trackId: string, fileName: string, bytes: Uint8Array, source: CoverSource, originalUrl?: string) {
  const trackDir = localCoverDir(trackId);
  await mkdir(trackDir, { recursive: true });
  const targetPath = path.join(trackDir, fileName);
  await writeFile(targetPath, bytes);
  await writeCachedManifest(trackId, {
    fileName,
    savedAt: new Date().toISOString(),
    source,
    originalUrl
  });
  return targetPath;
}

export async function findCoverInDirectory(directory: string, basename?: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));

  if (basename) {
    const exactMatch = files.find((entry) => path.basename(entry.name, path.extname(entry.name)).toLowerCase() === basename);
    if (exactMatch) {
      return path.join(directory, exactMatch.name);
    }
  }

  for (const name of COVER_BASENAMES) {
    const match = files.find((entry) => path.basename(entry.name, path.extname(entry.name)).toLowerCase() === name);
    if (match) {
      return path.join(directory, match.name);
    }
  }

  return null;
}

export async function findSiblingCover(filePath: string) {
  const directory = path.dirname(filePath);
  return findCoverInDirectory(directory, path.basename(filePath, path.extname(filePath)).toLowerCase());
}

export async function findCachedCover(trackId: string) {
  await mkdir(CACHE_DIR, { recursive: true });
  const manifest = await readCachedManifest(trackId);
  if (manifest) {
    const candidate = path.join(localCoverDir(trackId), manifest.fileName);
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // fall through to directory scan
    }
  }

  try {
    return await findCoverInDirectory(localCoverDir(trackId));
  } catch {
    return null;
  }
}

async function importSiblingCover(track: PlayableTrackSnapshot & { provider: "local"; localFilePath: string }) {
  const siblingPath = await findSiblingCover(track.localFilePath);
  if (!siblingPath) {
    return null;
  }

  const bytes = await readFile(siblingPath);
  const extension = path.extname(siblingPath).toLowerCase() || ".jpg";
  return saveCachedCover(track.providerTrackId, `cover-local${extension}`, bytes, "local");
}

async function waitForMusicBrainzSlot() {
  const now = Date.now();
  const waitMs = Math.max(0, 1100 - (now - lastMusicBrainzRequestAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastMusicBrainzRequestAt = Date.now();
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string, init?: RequestInit) {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function upgradeITunesArtworkUrl(url?: string) {
  if (!url) {
    return null;
  }

  return url.replace(/\d+x\d+bb/gi, "1200x1200bb");
}

async function searchITunesCover(track: PlayableTrackSnapshot, fetchImpl: typeof fetch): Promise<RemoteCoverCandidate | null> {
  const artist = primaryArtist(track.artist);
  if (!normalizeText(track.title) || !artist) {
    return null;
  }

  const params = new URLSearchParams({
    media: "music",
    entity: "song",
    limit: "5",
    term: `${track.title} ${artist}`
  });
  const payload = await fetchJson<{ results?: ITunesResult[] }>(fetchImpl, `https://itunes.apple.com/search?${params.toString()}`);
  const results = Array.isArray(payload.results) ? payload.results : [];
  let best: { score: number; artworkUrl: string } | null = null;

  for (const result of results) {
    const score = trackMatchScore(track, {
      title: result.trackName,
      artist: result.artistName,
      album: result.collectionName
    });
    const artworkUrl = upgradeITunesArtworkUrl(result.artworkUrl100 ?? result.artworkUrl60);
    if (!artworkUrl) {
      continue;
    }

    if (!best || score > best.score) {
      best = { score, artworkUrl };
    }
  }

  return best && best.score >= 8 ? { imageUrl: best.artworkUrl, source: "itunes" } : null;
}

function musicBrainzArtistName(credits?: MusicBrainzArtistCredit[]) {
  return (credits ?? [])
    .map((credit) => credit.artist?.name ?? credit.name ?? "")
    .filter(Boolean)
    .join(", ");
}

async function tryCoverArtArchive(fetchImpl: typeof fetch, imageUrl: string) {
  const response = await fetchImpl(imageUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": MUSICBRAINZ_USER_AGENT
    }
  });

  return response.ok ? response : null;
}

async function searchMusicBrainzCover(track: PlayableTrackSnapshot, fetchImpl: typeof fetch): Promise<RemoteCoverCandidate | null> {
  const title = normalizeText(track.title);
  const artist = primaryArtist(track.artist);
  if (!title || !artist) {
    return null;
  }

  const query = [`recording:"${track.title}"`, `artist:"${artist}"`];
  const album = meaningfulAlbum(track.album);
  if (album) {
    query.push(`release:"${track.album}"`);
  }

  await waitForMusicBrainzSlot();
  const params = new URLSearchParams({
    fmt: "json",
    limit: "5",
    query: query.join(" AND ")
  });
  const payload = await fetchJson<{ recordings?: MusicBrainzRecording[] }>(
    fetchImpl,
    `https://musicbrainz.org/ws/2/recording?${params.toString()}`,
    {
      headers: {
        "User-Agent": MUSICBRAINZ_USER_AGENT,
        Accept: "application/json"
      }
    }
  );

  const recordings = Array.isArray(payload.recordings) ? payload.recordings : [];
  const sorted = recordings
    .map((recording) => {
      const score = Number(recording.score ?? 0) + trackMatchScore(track, {
        title: recording.title,
        artist: musicBrainzArtistName(recording["artist-credit"]),
        album: recording.releases?.[0]?.title
      });
      return { recording, score };
    })
    .sort((left, right) => right.score - left.score);

  for (const item of sorted) {
    const releases = item.recording.releases ?? [];
    for (const release of releases) {
      const releaseId = release.id?.trim();
      if (releaseId) {
        const releaseUrl = `https://coverartarchive.org/release/${releaseId}/front-500`;
        const releaseResponse = await tryCoverArtArchive(fetchImpl, releaseUrl);
        if (releaseResponse) {
          return { imageUrl: releaseUrl, source: "musicbrainz" };
        }
      }

      const releaseGroupId = release["release-group"]?.id?.trim();
      if (releaseGroupId) {
        const releaseGroupUrl = `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`;
        const releaseGroupResponse = await tryCoverArtArchive(fetchImpl, releaseGroupUrl);
        if (releaseGroupResponse) {
          return { imageUrl: releaseGroupUrl, source: "musicbrainz" };
        }
      }
    }
  }

  return null;
}

async function downloadRemoteCover(trackId: string, candidate: RemoteCoverCandidate, fetchImpl: typeof fetch) {
  const response = await fetchImpl(candidate.imageUrl, { redirect: "follow" });
  if (!response.ok) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const extension = extensionFromContentType(response.headers.get("content-type"), candidate.imageUrl);
  return saveCachedCover(trackId, `cover-remote${extension}`, bytes, candidate.source, candidate.imageUrl);
}

function isLocalTrack(track: PlayableTrackSnapshot): track is PlayableTrackSnapshot & { provider: "local"; localFilePath: string } {
  return track.provider === "local" && typeof track.localFilePath === "string" && track.localFilePath.length > 0;
}

async function searchRemoteCover(track: PlayableTrackSnapshot, fetchImpl: typeof fetch) {
  try {
    const iTunesCandidate = await searchITunesCover(track, fetchImpl);
    if (iTunesCandidate) {
      return iTunesCandidate;
    }
  } catch {
    // Move on to MusicBrainz if iTunes fails.
  }

  try {
    return await searchMusicBrainzCover(track, fetchImpl);
  } catch {
    return null;
  }
}

export async function syncLocalLibraryCovers(
  library: PlayableLibrarySnapshot,
  options: {
    mode?: LocalCoverSyncMode;
    fetchImpl?: typeof fetch;
    startIndex?: number;
    maxTracks?: number;
  } = {}
) {
  const mode = options.mode ?? "local";
  const fetchImpl = options.fetchImpl ?? fetch;
  const startIndex = Math.max(0, options.startIndex ?? 0);
  const maxTracks = options.maxTracks && options.maxTracks > 0 ? options.maxTracks : Number.POSITIVE_INFINITY;
  const summary: LocalCoverSyncSummary = {
    totalTracks: library.tracks.length,
    scannedTracks: 0,
    reusedCached: 0,
    importedSibling: 0,
    downloadedRemote: 0,
    missing: 0,
    failed: 0
  };

  if (library.provider !== "local" || mode === "none") {
    return summary;
  }

  for (let index = startIndex; index < library.tracks.length && summary.scannedTracks < maxTracks; index += 1) {
    const track = library.tracks[index];
    if (!track) {
      continue;
    }

    summary.scannedTracks += 1;

    if (!isLocalTrack(track)) {
      summary.missing += 1;
      continue;
    }

    const cachedCover = await findCachedCover(track.providerTrackId);
    if (cachedCover) {
      const manifest = await readCachedManifest(track.providerTrackId);
      track.coverUrl =
        manifest?.source && manifest.source !== "local" && manifest.originalUrl
          ? manifest.originalUrl
          : localCoverUrl(track.providerTrackId);
      summary.reusedCached += 1;
      continue;
    }

    try {
      const siblingCover = await importSiblingCover(track);
      if (siblingCover) {
        track.coverUrl = localCoverUrl(track.providerTrackId);
        summary.importedSibling += 1;
        continue;
      }
    } catch {
      summary.failed += 1;
      continue;
    }

    if (mode !== "internet") {
      summary.missing += 1;
      continue;
    }

    try {
      const remoteCandidate = await searchRemoteCover(track, fetchImpl);
      if (!remoteCandidate) {
        summary.missing += 1;
        continue;
      }

      const downloaded = await downloadRemoteCover(track.providerTrackId, remoteCandidate, fetchImpl);
      if (!downloaded) {
        summary.failed += 1;
        continue;
      }

      track.coverUrl = remoteCandidate.imageUrl;
      summary.downloadedRemote += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}

export function buildGeneratedCover(title: string, artist: string) {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#090b11" />
        <stop offset="55%" stop-color="#131a25" />
        <stop offset="100%" stop-color="#0d1017" />
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="24%" r="52%">
        <stop offset="0%" stop-color="rgba(255,236,196,0.95)" />
        <stop offset="32%" stop-color="rgba(255,205,135,0.42)" />
        <stop offset="70%" stop-color="rgba(255,205,135,0)" />
      </radialGradient>
    </defs>
    <rect width="320" height="320" rx="30" fill="url(#bg)" />
    <rect x="24" y="24" width="272" height="272" rx="24" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
    <rect width="320" height="320" rx="30" fill="url(#glow)" />
    <g stroke="rgba(224,188,143,0.15)">
      <path d="M34 70 H286" />
      <path d="M34 122 H286" />
      <path d="M34 174 H286" />
      <path d="M34 226 H286" />
      <path d="M34 278 H286" />
      <path d="M70 34 V286" />
      <path d="M122 34 V286" />
      <path d="M174 34 V286" />
      <path d="M226 34 V286" />
      <path d="M278 34 V286" />
    </g>
    <circle cx="72" cy="72" r="12" fill="#f5d2a4" />
    <text x="34" y="176" fill="#f3f5f7" font-family="JetBrains Mono, monospace" font-size="30">${escapeSvg(title)}</text>
    <text x="34" y="214" fill="#9aa7bb" font-family="JetBrains Mono, monospace" font-size="16">${escapeSvg(artist)}</text>
    <text x="34" y="264" fill="#e0bc8f" font-family="JetBrains Mono, monospace" font-size="14">TOXY FM</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
