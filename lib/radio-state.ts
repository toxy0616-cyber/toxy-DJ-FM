import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { demoTracks } from "@/lib/data/demo-tracks";
import { readPlayableLibrary, resolveTrackCoverUrl, toTrackCandidate } from "@/lib/music-library";
import { getMusicProvider } from "@/lib/providers/music";
import type { ChatTurn, PlayableLibrarySnapshot, RadioState, TasteProfile, TrackCandidate, TrackIntent } from "@/lib/types";
import { dedupeTrimmed, stripUtf8Bom } from "@/lib/utils";

const DATA_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "radio-state.json");

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function starterIntent(profile: TasteProfile): TrackIntent {
  const rainyPalette = profile.moodMappings.find((item) => item.mood === "rainy")?.palette ?? [];

  return {
    mood: "rainy",
    energy: "low",
    palette: rainyPalette,
    avoid: profile.hardNo,
    rationale: "Boot on a calm, rain-lit frequency."
  };
}

function starterChat(_: string): ChatTurn[] {
  return [];
}

function shouldClearLegacyStarter(history: ChatTurn[]) {
  if (history.length !== 1 || history[0]?.role !== "assistant") {
    return false;
  }

  const text = history[0].text.toLowerCase();
  return text.includes("station is live") || text.includes("opening with something gentle");
}

function hydrateTrack(track: TrackCandidate | null | undefined) {
  if (!track) {
    return demoTracks[0];
  }

  const fallback = demoTracks.find((item) => item.id === track.id || item.providerTrackId === track.providerTrackId) ?? demoTracks[0];

  return {
    ...fallback,
    ...track,
    coverUrl: resolveTrackCoverUrl({
      provider: track.provider ?? (
        track.streamUrl?.includes("/api/audio/qq/")
          ? "qqmusic"
          : track.streamUrl?.includes("/api/audio/local/")
            ? "local"
            : "demo"
      ),
      providerTrackId: track.providerTrackId ?? track.id ?? fallback.providerTrackId,
      coverUrl: track.coverUrl
    }),
    provider: track.provider ?? (
      track.streamUrl?.includes("/api/audio/qq/")
        ? "qqmusic"
        : track.streamUrl?.includes("/api/audio/local/")
          ? "local"
          : "demo"
    ),
    providerTrackId: track.providerTrackId ?? track.id ?? fallback.providerTrackId,
    playable: track.playable ?? true,
    durationLabel: track.durationLabel ?? fallback.durationLabel
  } satisfies TrackCandidate;
}

function syncTrackWithLibrary(track: TrackCandidate, library: PlayableLibrarySnapshot | null) {
  const hydrated = hydrateTrack(track);
  if (!library) {
    return hydrated;
  }

  const matched = library.tracks.find(
    (item) => item.provider === hydrated.provider && item.providerTrackId === hydrated.providerTrackId
  );
  if (!matched) {
    return hydrated;
  }

  return {
    ...hydrated,
    ...toTrackCandidate(matched),
    coverUrl: resolveTrackCoverUrl(matched),
    playable: matched.playable
  } satisfies TrackCandidate;
}

function hydrateRadioState(state: RadioState | null, library: PlayableLibrarySnapshot | null) {
  if (!state) {
    return null;
  }

  const nowPlaying = syncTrackWithLibrary(state.nowPlaying, library);
  const queue = (state.queue ?? []).map((track) => syncTrackWithLibrary(track, library));

  return {
    ...state,
    nowPlaying,
    queue,
    recentTrackKeys:
      state.recentTrackKeys && state.recentTrackKeys.length > 0
        ? state.recentTrackKeys
        : [nowPlaying.provider + ":" + nowPlaying.providerTrackId],
    activeSwitchToken: state.activeSwitchToken ?? null,
    chatHistory: shouldClearLegacyStarter(state.chatHistory ?? [])
      ? []
      : (state.chatHistory ?? []).slice(-14)
  } satisfies RadioState;
}

function trackKey(track: TrackCandidate) {
  return `${track.provider}:${track.providerTrackId}`;
}

export async function createInitialRadioState(profile: TasteProfile): Promise<RadioState> {
  const provider = getMusicProvider();
  const intent = starterIntent(profile);
  const nowPlaying = await provider.pickTrack(intent, profile);
  const queue = await provider.buildQueue(nowPlaying, intent, profile);

  return {
    nowPlaying,
    queue,
    mood: "rainy",
    onAirLine: "Late-night frequency established.",
    lastReason: "Opening with a softer record to give the station room to breathe.",
    updatedAt: new Date().toISOString(),
    recentMoods: ["rainy"],
    recentTrackKeys: [trackKey(nowPlaying)],
    chatHistory: starterChat(nowPlaying.id),
    activeSwitchToken: null
  };
}

export async function readRadioState() {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const library = await readPlayableLibrary();
    return hydrateRadioState(JSON.parse(stripUtf8Bom(raw)) as RadioState, library);
  } catch {
    return null;
  }
}

export async function saveRadioState(state: RadioState) {
  await ensureDataDir();
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export async function ensureRadioState(profile: TasteProfile) {
  const existing = await readRadioState();

  if (existing) {
    const library = await readPlayableLibrary();
    if (existing.nowPlaying.provider === "demo" && library && library.tracks.length > 0) {
      const initial = await createInitialRadioState(profile);
      const migrated = {
        ...initial,
        chatHistory: existing.chatHistory,
        recentMoods: existing.recentMoods.length > 0 ? existing.recentMoods : initial.recentMoods
      } satisfies RadioState;
      await saveRadioState(migrated);
      return migrated;
    }

    return existing;
  }

  const initial = await createInitialRadioState(profile);
  await saveRadioState(initial);
  return initial;
}

export function pushMood(state: RadioState, mood: string) {
  return dedupeTrimmed([mood, ...state.recentMoods], 6);
}

export function pushTrackKey(state: RadioState, track: TrackCandidate) {
  return dedupeTrimmed([trackKey(track), ...(state.recentTrackKeys ?? [])], 24);
}
