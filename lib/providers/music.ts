import { demoTracks } from "@/lib/data/demo-tracks";
import { readPlayableLibrary, toTrackCandidate } from "@/lib/music-library";
import type { TasteProfile, TrackCandidate, TrackIntent, WhyRejectedEntry, WhySelectedEntry } from "@/lib/types";
import { uniqueStrings } from "@/lib/utils";

export interface TrackSelectionExplanation {
  selectedTrack: TrackCandidate;
  queue: TrackCandidate[];
  why_selected: WhySelectedEntry[];
  why_rejected: WhyRejectedEntry[];
}

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
  selectTrackWithExplanation(
    intent: TrackIntent,
    profile: TasteProfile,
    options?: { current?: TrackCandidate; recentTrackKeys?: string[]; forcedTrack?: TrackCandidate }
  ): Promise<TrackSelectionExplanation>;
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

type TrackEvaluation = {
  baseScore: number;
  recencyPenalty: number;
  totalScore: number;
  positiveSignals: WhySelectedEntry[];
  hasPaletteMatch: boolean;
};

function roundScore(value: number) {
  return Number(value.toFixed(2));
}

function evaluateTrack(track: TrackCandidate, intent: TrackIntent, profile: TasteProfile, recentTrackKeys: string[]): TrackEvaluation {
  let score = 0;
  const positiveSignals: WhySelectedEntry[] = [];
  const normalizedTags = track.tags.map((tag) => tag.toLowerCase());

  if (track.mood === intent.mood) {
    score += 4;
    positiveSignals.push({
      label: "mood_match",
      scoreDelta: 4,
      detail: `Mood matches the request (${intent.mood}).`
    });
  }

  if (track.energy === intent.energy) {
    score += 2;
    positiveSignals.push({
      label: "energy_match",
      scoreDelta: 2,
      detail: `Energy matches the request (${intent.energy}).`
    });
  }

  let paletteHits = 0;
  for (const palette of intent.palette) {
    const normalizedPalette = palette.toLowerCase();
    if (normalizedTags.some((tag) => tag.includes(normalizedPalette))) {
      score += 1.5;
      paletteHits += 1;
    }
  }

  if (paletteHits > 0) {
    const paletteScore = roundScore(paletteHits * 1.5);
    positiveSignals.push({
      label: "palette_match",
      scoreDelta: paletteScore,
      detail: `Matched ${paletteHits} palette cue${paletteHits > 1 ? "s" : ""} from the requested texture.`
    });
  }

  let genreScore = 0;
  const matchedGenres: string[] = [];
  for (const genre of profile.genres) {
    const genreNeedle = genre.name.toLowerCase().replace(/\s+/g, "-");
    if (normalizedTags.some((tag) => tag.includes(genreNeedle))) {
      const delta = genre.weight * 2;
      score += delta;
      genreScore += delta;
      matchedGenres.push(genre.name);
    }
  }

  if (genreScore > 0) {
    positiveSignals.push({
      label: "genre_affinity",
      scoreDelta: roundScore(genreScore),
      detail: `Aligned with your taste genres (${matchedGenres.slice(0, 2).join(" / ")}).`
    });
  }

  const index = recentTrackKeys.indexOf(trackKey(track));
  const penalty = index === -1 ? 0 : Math.max(2, 18 - index * 0.75);
  const totalScore = score - penalty;

  return {
    baseScore: roundScore(score),
    recencyPenalty: roundScore(penalty),
    totalScore: roundScore(totalScore),
    positiveSignals,
    hasPaletteMatch: paletteHits > 0
  };
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

type ScoredTrack = {
  track: TrackCandidate;
  evaluation: TrackEvaluation;
  blocked: boolean;
  duplicateCurrent: boolean;
  playable: boolean;
};

function rankedScore(scoredTrack: ScoredTrack) {
  return scoredTrack.evaluation.totalScore;
}

function pickFromRankedPool(
  ranked: ScoredTrack[],
  windowSize: number
) {
  if (ranked.length === 0) {
    return null;
  }

  const bestScore = rankedScore(ranked[0]);
  const pool = ranked
    .filter((track, index) => index < windowSize || bestScore - rankedScore(track) <= 1.5)
    .slice(0, windowSize);

  if (pool.length === 0) {
    return ranked[0]?.track ?? null;
  }

  return pool[Math.floor(Math.random() * pool.length)]?.track ?? ranked[0]?.track ?? null;
}

function shuffleRankedPool(
  ranked: ScoredTrack[],
  windowSize: number
) {
  if (ranked.length <= 1) {
    return ranked.map((item) => item.track);
  }

  const bestScore = rankedScore(ranked[0]);
  const pool = ranked
    .filter((track, index) => index < windowSize || bestScore - rankedScore(track) <= 1.5)
    .slice(0, windowSize)
    .map((track) => ({ track: track.track, weight: Math.random() }));

  const poolKeys = new Set(pool.map(({ track }) => trackKey(track)));
  const shuffledPool = pool.sort((left, right) => left.weight - right.weight).map(({ track }) => track);
  const rest = ranked.map((item) => item.track).filter((track) => !poolKeys.has(trackKey(track)));
  return [...shuffledPool, ...rest];
}

function rankTracks(scoredTracks: ScoredTrack[]) {
  return scoredTracks
    .map((scoredTrack) => ({
      scoredTrack,
      score: rankedScore(scoredTrack),
      jitter: randomJitter()
    }))
    .sort((left, right) => right.score + right.jitter - (left.score + left.jitter))
    .map((entry) => entry.scoredTrack);
}

function summarizeSelectedReasons(scoredTrack: ScoredTrack): WhySelectedEntry[] {
  const reasons = [...scoredTrack.evaluation.positiveSignals].sort((left, right) => right.scoreDelta - left.scoreDelta).slice(0, 3);

  if (reasons.length > 0) {
    return reasons;
  }

  return [
    {
      label: "best_available_match",
      scoreDelta: roundScore(Math.max(scoredTrack.evaluation.totalScore, 0)),
      detail: "Best available playable option under current constraints."
    }
  ];
}

function summarizeRejectedReason(scoredTrack: ScoredTrack, selectedTrack: ScoredTrack, intent: TrackIntent): WhyRejectedEntry {
  if (!scoredTrack.playable) {
    return {
      trackId: scoredTrack.track.id,
      title: scoredTrack.track.title,
      artist: scoredTrack.track.artist,
      scoreDelta: -12,
      detail: "Track is not playable."
    };
  }

  if (scoredTrack.blocked) {
    return {
      trackId: scoredTrack.track.id,
      title: scoredTrack.track.title,
      artist: scoredTrack.track.artist,
      scoreDelta: -10,
      detail: "Track conflicts with hard-no vocabulary and was filtered out."
    };
  }

  if (scoredTrack.duplicateCurrent) {
    return {
      trackId: scoredTrack.track.id,
      title: scoredTrack.track.title,
      artist: scoredTrack.track.artist,
      scoreDelta: -8,
      detail: "Track is the same as the current song, so rotation skipped it."
    };
  }

  if (scoredTrack.track.mood !== intent.mood) {
    return {
      trackId: scoredTrack.track.id,
      title: scoredTrack.track.title,
      artist: scoredTrack.track.artist,
      scoreDelta: -4,
      detail: `Mood mismatch (${scoredTrack.track.mood} vs requested ${intent.mood}).`
    };
  }

  if (scoredTrack.track.energy !== intent.energy) {
    return {
      trackId: scoredTrack.track.id,
      title: scoredTrack.track.title,
      artist: scoredTrack.track.artist,
      scoreDelta: -2,
      detail: `Energy mismatch (${scoredTrack.track.energy} vs requested ${intent.energy}).`
    };
  }

  if (intent.palette.length > 0 && !scoredTrack.evaluation.hasPaletteMatch) {
    return {
      trackId: scoredTrack.track.id,
      title: scoredTrack.track.title,
      artist: scoredTrack.track.artist,
      scoreDelta: -1.5,
      detail: "Did not match the requested palette cues."
    };
  }

  if (scoredTrack.evaluation.recencyPenalty > 0) {
    return {
      trackId: scoredTrack.track.id,
      title: scoredTrack.track.title,
      artist: scoredTrack.track.artist,
      scoreDelta: -scoredTrack.evaluation.recencyPenalty,
      detail: "Penalized because it played too recently."
    };
  }

  return {
    trackId: scoredTrack.track.id,
    title: scoredTrack.track.title,
    artist: scoredTrack.track.artist,
    scoreDelta: roundScore(scoredTrack.evaluation.totalScore - selectedTrack.evaluation.totalScore),
    detail: `Lower composite score (${scoredTrack.evaluation.totalScore}) than selected track (${selectedTrack.evaluation.totalScore}).`
  };
}

function buildScoredTracks(
  tracks: TrackCandidate[],
  intent: TrackIntent,
  profile: TasteProfile,
  current: TrackCandidate | undefined,
  recentTrackKeys: string[]
) {
  return tracks.map((track) => {
    const duplicateCurrent = Boolean(current && trackKey(current) === trackKey(track));
    const blocked = matchesBlocklist(track, profile);
    const evaluation = evaluateTrack(track, intent, profile, recentTrackKeys);

    return {
      track,
      evaluation,
      blocked,
      duplicateCurrent,
      playable: track.playable
    } satisfies ScoredTrack;
  });
}

function findScoredTrack(scoredTracks: ScoredTrack[], track: TrackCandidate) {
  return scoredTracks.find((entry) => trackKey(entry.track) === trackKey(track));
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
    const result = await this.selectTrackWithExplanation(intent, profile, {
      current,
      recentTrackKeys: options?.recentTrackKeys
    });

    return result.selectedTrack;
  }

  async selectTrackWithExplanation(
    intent: TrackIntent,
    profile: TasteProfile,
    options?: { current?: TrackCandidate; recentTrackKeys?: string[]; forcedTrack?: TrackCandidate }
  ) {
    const tracks = await availableTracks();
    const recentTrackKeys = options?.recentTrackKeys ?? [];
    const current = options?.current;
    const scoredTracks = buildScoredTracks(tracks, intent, profile, current, recentTrackKeys);
    const eligible = scoredTracks.filter((track) => track.playable && !track.blocked && !track.duplicateCurrent);
    const ranked = rankTracks(eligible);

    let selectedTrack: TrackCandidate | null = null;
    const forcedTrack = options?.forcedTrack;
    if (forcedTrack) {
      const forcedScoredTrack = findScoredTrack(scoredTracks, forcedTrack);
      if (forcedScoredTrack && forcedScoredTrack.playable && !forcedScoredTrack.blocked && !forcedScoredTrack.duplicateCurrent) {
        selectedTrack = forcedScoredTrack.track;
      }
    }

    selectedTrack = selectedTrack ?? ranked[0]?.track ?? tracks[0] ?? demoTracks[0];
    const selectedScoredTrack =
      findScoredTrack(scoredTracks, selectedTrack) ??
      ({
        track: selectedTrack,
        evaluation: evaluateTrack(selectedTrack, intent, profile, recentTrackKeys),
        blocked: false,
        duplicateCurrent: false,
        playable: selectedTrack.playable
      } satisfies ScoredTrack);

    const queue = await this.buildQueue(selectedTrack, intent, profile, {
      recentTrackKeys: [trackKey(selectedTrack), ...recentTrackKeys]
    });
    const why_selected = summarizeSelectedReasons(selectedScoredTrack);
    const why_rejected = scoredTracks
      .filter((track) => trackKey(track.track) !== trackKey(selectedTrack))
      .sort((left, right) => right.evaluation.totalScore - left.evaluation.totalScore)
      .map((track) => summarizeRejectedReason(track, selectedScoredTrack, intent))
      .slice(0, 3);

    return {
      selectedTrack,
      queue,
      why_selected,
      why_rejected
    } satisfies TrackSelectionExplanation;
  }

  async buildQueue(track: TrackCandidate, intent: TrackIntent, profile: TasteProfile, options?: { recentTrackKeys?: string[] }) {
    const tracks = await availableTracks();
    const recentTrackKeys = options?.recentTrackKeys ?? [];
    const scoredTracks = buildScoredTracks(tracks, intent, profile, undefined, recentTrackKeys);
    const rankedPool = scoredTracks
      .filter((candidate) => trackKey(candidate.track) !== trackKey(track))
      .filter((candidate) => candidate.playable && !candidate.blocked);
    const ranked = rankTracks(rankedPool);

    return shuffleRankedPool(ranked, 8).slice(0, 3);
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
