import { demoTracks } from "@/lib/data/demo-tracks";
import { readPlayableLibrary, toTrackCandidate } from "@/lib/music-library";
import type { TasteProfile, TrackCandidate, TrackIntent } from "@/lib/types";
import { uniqueStrings } from "@/lib/utils";

export interface MusicProvider {
  pickTrack(
    intent: TrackIntent,
    profile: TasteProfile,
    current?: TrackCandidate,
    options?: { recentTrackKeys?: string[] }
  ): Promise<TrackCandidate>;
  buildQueue(
    track: TrackCandidate,
    intent: TrackIntent,
    profile: TasteProfile,
    options?: { recentTrackKeys?: string[] }
  ): Promise<TrackCandidate[]>;
  search(query: string, limit?: number): Promise<TrackCandidate[]>;
}

function blockedWords(profile: TasteProfile) {
  return uniqueStrings(
    profile.hardNo
      .flatMap((item) => item.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/))
      .filter((item) => item.length > 2)
  );
}

function trackKey(track: TrackCandidate) {
  return `${track.provider}:${track.providerTrackId}`;
}

function scoreTrack(track: TrackCandidate, intent: TrackIntent, profile: TasteProfile) {
  let score = 0;

  if (track.mood === intent.mood) {
    score += 4;
  }

  if (track.energy === intent.energy) {
    score += 2;
  }

  for (const palette of intent.palette) {
    if (track.tags.some((tag) => tag.toLowerCase().includes(palette.toLowerCase()))) {
      score += 1.5;
    }
  }

  for (const genre of profile.genres) {
    if (track.tags.some((tag) => tag.toLowerCase().includes(genre.name.toLowerCase().replace(/\s+/g, "-")))) {
      score += genre.weight * 2;
    }
  }

  return score;
}

function recencyPenalty(track: TrackCandidate, recentTrackKeys: string[]) {
  const index = recentTrackKeys.indexOf(trackKey(track));
  if (index === -1) {
    return 0;
  }

  return Math.max(2, 18 - index * 0.75);
}

function matchesBlocklist(track: TrackCandidate, profile: TasteProfile) {
  const haystack = `${track.title} ${track.artist} ${track.album} ${track.tags.join(" ")}`.toLowerCase();
  return blockedWords(profile).some((word) => haystack.includes(word));
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function searchScore(track: TrackCandidate, needle: string) {
  const title = track.title.toLowerCase();
  const artist = track.artist.toLowerCase();
  const album = track.album.toLowerCase();
  const haystack = `${title} ${artist} ${album} ${track.tags.join(" ").toLowerCase()}`;

  if (title === needle) {
    return 100;
  }

  if (`${artist} ${title}` === needle || `${title} ${artist}` === needle) {
    return 98;
  }

  if (title.includes(needle)) {
    return 92;
  }

  if (artist.includes(needle)) {
    return 88;
  }

  if (album.includes(needle)) {
    return 80;
  }

  const tokens = needle.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return 0;
  }

  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) {
      score += 20;
      continue;
    }

    if (artist.includes(token)) {
      score += 16;
      continue;
    }

    if (album.includes(token) || haystack.includes(token)) {
      score += 10;
    }
  }

  return score;
}

function randomJitter() {
  return Math.random() * 0.9;
}

function rankedScore(track: TrackCandidate, intent: TrackIntent, profile: TasteProfile, recentTrackKeys: string[]) {
  return scoreTrack(track, intent, profile) - recencyPenalty(track, recentTrackKeys);
}

function pickFromRankedPool(
  ranked: TrackCandidate[],
  intent: TrackIntent,
  profile: TasteProfile,
  recentTrackKeys: string[],
  windowSize: number
) {
  if (ranked.length === 0) {
    return null;
  }

  const bestScore = rankedScore(ranked[0], intent, profile, recentTrackKeys);
  const pool = ranked
    .filter((track, index) => index < windowSize || bestScore - rankedScore(track, intent, profile, recentTrackKeys) <= 1.5)
    .slice(0, windowSize);

  if (pool.length === 0) {
    return ranked[0];
  }

  return pool[Math.floor(Math.random() * pool.length)] ?? ranked[0];
}

function shuffleRankedPool(
  ranked: TrackCandidate[],
  intent: TrackIntent,
  profile: TasteProfile,
  recentTrackKeys: string[],
  windowSize: number
) {
  if (ranked.length <= 1) {
    return ranked;
  }

  const bestScore = rankedScore(ranked[0], intent, profile, recentTrackKeys);
  const pool = ranked
    .filter((track, index) => index < windowSize || bestScore - rankedScore(track, intent, profile, recentTrackKeys) <= 1.5)
    .slice(0, windowSize)
    .map((track) => ({ track, weight: Math.random() }));

  const poolKeys = new Set(pool.map(({ track }) => trackKey(track)));
  const shuffledPool = pool.sort((left, right) => left.weight - right.weight).map(({ track }) => track);
  const rest = ranked.filter((track) => !poolKeys.has(trackKey(track)));
  return [...shuffledPool, ...rest];
}

function rankTracks(tracks: TrackCandidate[], intent: TrackIntent, profile: TasteProfile, recentTrackKeys: string[]) {
  return tracks
    .map((track) => ({
      track,
      score: rankedScore(track, intent, profile, recentTrackKeys),
      jitter: randomJitter()
    }))
    .sort((left, right) => right.score + right.jitter - (left.score + left.jitter))
    .map((entry) => entry.track);
}

async function availableTracks() {
  const library = await readPlayableLibrary();
  if (!library || library.tracks.length === 0) {
    return demoTracks;
  }

  return library.tracks.map(toTrackCandidate);
}

class HybridMusicProvider implements MusicProvider {
  async pickTrack(intent: TrackIntent, profile: TasteProfile, current?: TrackCandidate, options?: { recentTrackKeys?: string[] }) {
    const tracks = await availableTracks();
    const recentTrackKeys = options?.recentTrackKeys ?? [];
    const pool = tracks.filter((track) => {
      if (!track.playable) {
        return false;
      }

      if (current && trackKey(current) === trackKey(track)) {
        return false;
      }

      return !matchesBlocklist(track, profile);
    });

    const ranked = rankTracks(pool, intent, profile, recentTrackKeys);

    return pickFromRankedPool(ranked, intent, profile, recentTrackKeys, 8) ?? tracks[0] ?? demoTracks[0];
  }

  async buildQueue(track: TrackCandidate, intent: TrackIntent, profile: TasteProfile, options?: { recentTrackKeys?: string[] }) {
    const tracks = await availableTracks();
    const recentTrackKeys = options?.recentTrackKeys ?? [];
    const rankedPool = tracks
      .filter((candidate) => trackKey(candidate) !== trackKey(track))
      .filter((candidate) => candidate.playable && !matchesBlocklist(candidate, profile));
    const ranked = rankTracks(rankedPool, intent, profile, recentTrackKeys);

    return shuffleRankedPool(ranked, intent, profile, recentTrackKeys, 8).slice(0, 3);
  }

  async search(query: string, limit = 5) {
    const needle = normalizeQuery(query);
    if (!needle) {
      return [];
    }

    const tracks = await availableTracks();

    return tracks
      .filter((track) => track.playable)
      .map((track) => ({ track, score: searchScore(track, needle) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.track.title.localeCompare(right.track.title))
      .slice(0, limit)
      .map((entry) => entry.track);
  }
}

const provider = new HybridMusicProvider();

export function getMusicProvider() {
  return provider;
}
