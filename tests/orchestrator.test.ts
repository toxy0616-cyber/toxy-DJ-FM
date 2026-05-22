import { afterEach, describe, expect, test, vi } from "vitest";

import { parseControlIntent } from "@/lib/control-intent";
import type { RadioState, TasteProfile, TrackCandidate, TrackIntent, WhyRejectedEntry, WhySelectedEntry } from "@/lib/types";

function buildTrack(overrides?: Partial<TrackCandidate>): TrackCandidate {
  return {
    id: "local-current-track",
    title: "Current Song",
    artist: "Current Artist",
    album: "Now",
    durationLabel: "03:00",
    mood: "drained",
    energy: "low",
    tags: ["calm"],
    coverUrl: "/cover/current.jpg",
    streamUrl: "/stream/current.mp3",
    provider: "local",
    providerTrackId: "current-track",
    playable: true,
    ...overrides
  };
}

function buildProfile(): TasteProfile {
  return {
    tagline: "Test profile",
    intro: "Test intro",
    djVoice: "Test voice",
    genres: [{ name: "soft rock", weight: 0.9 }],
    artists: ["Imagine Dragons"],
    eras: ["10s"],
    scenes: ["late-night drift"],
    moodMappings: [
      { mood: "rainy", palette: ["rain", "soft"] },
      { mood: "drained", palette: ["calm", "warm"] }
    ],
    hardNo: [],
    radioRules: ["Keep it steady."],
    signaturePlaylists: ["late-night drift"],
    rawMarkdown: "# taste"
  };
}

function buildState(): RadioState {
  return {
    nowPlaying: buildTrack(),
    queue: [
      buildTrack({
        id: "local-queue-1",
        title: "Queue One",
        artist: "Queue Artist",
        providerTrackId: "queue-1"
      }),
      buildTrack({
        id: "local-queue-2",
        title: "Queue Two",
        artist: "Queue Artist",
        providerTrackId: "queue-2"
      }),
      buildTrack({
        id: "local-queue-3",
        title: "Queue Three",
        artist: "Queue Artist",
        providerTrackId: "queue-3"
      })
    ],
    mood: "drained",
    onAirLine: "Signal is live.",
    lastReason: "Base state for tests.",
    updatedAt: "2026-05-12T00:00:00.000Z",
    recentMoods: ["drained"],
    recentTrackKeys: ["local:current-track"],
    chatHistory: [],
    activeSwitchToken: null
  };
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Harness = {
  handleChat: (message: string, options?: { latitude?: number; longitude?: number }) => ReturnType<typeof import("@/lib/orchestrator")["handleChat"]>;
  fetchWeatherContext: ReturnType<typeof vi.fn>;
  llmGenerate: ReturnType<typeof vi.fn>;
  ragSelectTrackWithExplanation: ReturnType<typeof vi.fn>;
  musicProvider: {
    pickTrack: ReturnType<typeof vi.fn>;
    buildQueue: ReturnType<typeof vi.fn>;
    selectTrackWithExplanation: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };
};

async function createHandleChatHarness(): Promise<Harness> {
  vi.resetModules();

  const profile = buildProfile();
  const state = buildState();
  const rainTrack = buildTrack({
    id: "local-rain-track",
    title: "Rain",
    artist: "Shining",
    mood: "rainy",
    providerTrackId: "rain-track",
    tags: ["rain", "gentle"]
  });
  const queueTrack = buildTrack({
    id: "local-rain-queue",
    title: "Rain Queue",
    artist: "Queue Artist",
    mood: "rainy",
    providerTrackId: "rain-queue",
    tags: ["rain", "late-night"]
  });
  const nightDriveTrack = buildTrack({
    id: "local-night-drive",
    title: "Night Drive",
    artist: "Blue Signal",
    mood: "calm",
    energy: "low",
    providerTrackId: "night-drive",
    tags: ["night", "drive", "late-night"]
  });
  const recommendationTracks = [rainTrack, queueTrack, nightDriveTrack];

  const ragSelectTrackWithExplanation = vi.fn().mockResolvedValue({
    selectedTracks: recommendationTracks,
    candidateTracks: [recommendationTracks[0], recommendationTracks[1], state.queue[0]],
    explanations: [
      { label: "mood_match", scoreDelta: 4, detail: "Mood matches the request (rainy)." },
      { label: "energy_match", scoreDelta: 2, detail: "Energy stays low and steady for the drive." },
      { label: "palette_match", scoreDelta: 1.5, detail: "Late-night drive texture fits the request." }
    ] satisfies WhySelectedEntry[]
  });

  const llmGenerate = vi.fn().mockImplementation(async (input: {
    recommendationContext?: {
      selectedTracks: TrackCandidate[];
    };
  }) => {
    if (input.recommendationContext) {
      const picks = input.recommendationContext.selectedTracks
        .map((track) => `${track.title} - ${track.artist}`)
        .join(" / ");

      return {
        reply: `Try these: ${picks}.`,
        reason: "Built a recommendation set from local RAG matches.",
        mood: "rainy",
        onAirLine: "Recommendation mode stayed on the current song while surfacing local matches.",
        trackIntent: {
          mood: "rainy",
          energy: "low",
          palette: ["rain", "gentle"],
          keywords: ["rain", "night-drive"],
          avoid: [],
          rationale: "Stay with the recommendation set."
        } satisfies TrackIntent,
        controlIntent: { type: "none" as const }
      };
    }

    return {
      reply: "The booth is retuned.",
      reason: "Matched the request and kept the atmosphere.",
      mood: "rainy",
      onAirLine: "Rain is on air.",
      trackIntent: {
        mood: "rainy",
        energy: "low",
        palette: ["rain", "gentle"],
        keywords: ["rain"],
        avoid: [],
        rationale: "Stay with rain."
      } satisfies TrackIntent,
      controlIntent: { type: "none" as const }
    };
  });

  const fetchWeatherContext = vi.fn().mockResolvedValue({
    summary: "Light rain over the harbor.",
    source: "ip" as const,
    locationLabel: "Hong Kong"
  });

  const vectorStore = {
    load: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(1)
  };

  const playableLibrary = {
    provider: "local" as const,
    importedAt: "2026-05-20T00:00:00.000Z",
    tracks: []
  };

  const ragMusicProvider = {
    selectTrackWithExplanation: ragSelectTrackWithExplanation
  };

  const musicProvider = {
    pickTrack: vi.fn().mockResolvedValue(rainTrack),
    buildQueue: vi.fn().mockResolvedValue([queueTrack, state.queue[0], state.queue[1]]),
    selectTrackWithExplanation: vi.fn().mockResolvedValue({
      selectedTrack: rainTrack,
      queue: [queueTrack, state.queue[0], state.queue[1]],
      why_selected: [
        { label: "mood_match", scoreDelta: 4, detail: "Mood matches the request (rainy)." }
      ] satisfies WhySelectedEntry[],
      why_rejected: [
        {
          trackId: state.queue[0].id,
          title: state.queue[0].title,
          artist: state.queue[0].artist,
          scoreDelta: -2,
          detail: "Energy mismatch."
        }
      ] satisfies WhyRejectedEntry[]
    }),
    search: vi.fn().mockImplementation(async (query: string) => {
      if (query.toLowerCase().includes("rain")) {
        return [rainTrack];
      }

      return [state.queue[0]];
    })
  };

  vi.doMock("@/lib/taste", () => ({
    readTasteProfile: vi.fn().mockResolvedValue(cloneValue(profile))
  }));
  vi.doMock("@/lib/music-library", () => ({
    readPlayableLibrary: vi.fn().mockResolvedValue(cloneValue(playableLibrary))
  }));
  vi.doMock("@/lib/vector-store", () => ({
    getVectorStore: vi.fn(() => vectorStore),
    resetVectorStore: vi.fn()
  }));
  vi.doMock("@/lib/startup", () => ({
    initializeMusicVectorStore: vi.fn().mockResolvedValue(undefined)
  }));
  vi.doMock("@/lib/radio-state", () => ({
    ensureRadioState: vi.fn().mockResolvedValue(cloneValue(state)),
    saveRadioState: vi.fn().mockResolvedValue(undefined),
    pushMood: vi.fn((currentState: RadioState, mood: string) => [mood, ...currentState.recentMoods].slice(0, 6)),
    pushTrackKey: vi.fn((currentState: RadioState, track: TrackCandidate) => {
      const key = `${track.provider}:${track.providerTrackId}`;
      return [key, ...currentState.recentTrackKeys].slice(0, 24);
    })
  }));
  vi.doMock("@/lib/providers/music", () => ({
    getMusicProvider: vi.fn(() => musicProvider)
  }));
  vi.doMock("@/lib/providers/rag-music", () => ({
    RAGMusicProvider: vi.fn(() => ragMusicProvider)
  }));
  vi.doMock("@/lib/providers/llm", () => ({
    getLlmProvider: vi.fn(() => ({
      generate: llmGenerate
    })),
    hasLiveLlmConfig: vi.fn(() => false)
  }));
  vi.doMock("@/lib/weather", () => ({
    fetchWeatherContext
  }));
  vi.doMock("@/lib/context", () => ({
    buildRuntimeContext: vi.fn(() => ({
      dayPart: "night",
      dayName: "Monday",
      localTime: "22:00",
      currentMood: "drained",
      recentMessages: []
    }))
  }));

  const orchestratorModule = await import("@/lib/orchestrator");

  return {
    handleChat: orchestratorModule.handleChat,
    fetchWeatherContext,
    llmGenerate,
    ragSelectTrackWithExplanation,
    musicProvider
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("parseControlIntent", () => {
  test("parses next track commands in Chinese", () => {
    expect(parseControlIntent("\u4e0b\u4e00\u9996")).toEqual({ type: "next" });
  });

  test("parses queue index commands", () => {
    expect(parseControlIntent("\u5207\u5230\u7b2c2\u9996")).toEqual({ type: "queue_index", queueIndex: 2 });
  });

  test("parses named track requests", () => {
    expect(parseControlIntent("\u64ad\u653e\u5468\u6770\u4f26\u7684\u6674\u5929")).toEqual({
      type: "track_query",
      query: "\u5468\u6770\u4f26\u7684\u6674\u5929"
    });
  });

  test("parses natural Chinese request phrasing", () => {
    expect(parseControlIntent("\u6211\u60f3\u542c\u6674\u5929")).toEqual({
      type: "track_query",
      query: "\u6674\u5929"
    });
  });

  test("parses artist-style request phrasing", () => {
    expect(parseControlIntent("\u7ed9\u6211\u653e\u4e00\u9996 kanye \u7684\u6b4c")).toEqual({
      type: "track_query",
      query: "\u4e00\u9996 kanye \u7684\u6b4c"
    });
  });

  test("parses english listen commands", () => {
    expect(parseControlIntent("listen to Numb")).toEqual({ type: "track_query", query: "Numb" });
  });

  test("ignores regular conversation", () => {
    expect(parseControlIntent("\u6211\u4eca\u5929\u6709\u70b9\u7d2f")).toEqual({ type: "none" });
  });
});

describe("handleChat routing priority", () => {
  test.each(["play rain", "\u6211\u60f3\u542crain", "\u653e\u4e00\u9996rain"])(
    "prioritizes control intent for track request: %s",
    async (message) => {
      const harness = await createHandleChatHarness();

      const payload = await harness.handleChat(message);

      expect(payload.controlIntent.type).toBe("track_query");
      expect(payload.selectionStatus).toBe("picked");
      expect(payload.weatherSummary).toBeUndefined();
      expect(payload.why_selected?.length).toBeGreaterThan(0);
      expect(payload.why_rejected?.length).toBeGreaterThan(0);
      expect(harness.fetchWeatherContext).not.toHaveBeenCalled();
      expect(harness.musicProvider.search).toHaveBeenCalled();
      expect(harness.musicProvider.selectTrackWithExplanation).toHaveBeenCalled();
      expect(harness.llmGenerate).toHaveBeenCalled();
    }
  );

  test("keeps pure weather requests on the weather branch", async () => {
    const harness = await createHandleChatHarness();

    const payload = await harness.handleChat("what's the weather today?");

    expect(payload.controlIntent).toEqual({ type: "none" });
    expect(payload.reason).toBe("Answered with location-aware weather context.");
    expect(payload.weatherSummary).toBe("Light rain over the harbor.");
    expect(payload.assistantTurn.text).toContain("Light rain over the harbor.");
    expect(harness.fetchWeatherContext).toHaveBeenCalledTimes(1);
    expect(harness.llmGenerate).not.toHaveBeenCalled();
  });

  test("keeps location requests on the weather/location branch", async () => {
    const harness = await createHandleChatHarness();

    const payload = await harness.handleChat("where am i right now?");

    expect(payload.controlIntent).toEqual({ type: "none" });
    expect(payload.weatherSummary).toBe("Light rain over the harbor.");
    expect(payload.assistantTurn.text).toContain("Hong Kong");
    expect(harness.fetchWeatherContext).toHaveBeenCalledTimes(1);
    expect(harness.llmGenerate).not.toHaveBeenCalled();
  });

  test("routes recommendation requests through local RAG and keeps them in chat", async () => {
    const harness = await createHandleChatHarness();

    const payload = await harness.handleChat("我想听有点忧郁的夜晚开车歌单");

    expect(payload.controlIntent).toEqual({ type: "none" });
    expect(payload.selectionStatus).toBe("candidate_required");
    expect(payload.assistantTurn.text).toContain("Try these:");
    expect(payload.candidateTracks?.length).toBeGreaterThan(0);
    expect(payload.why_selected?.length).toBeGreaterThan(0);
    expect(harness.ragSelectTrackWithExplanation).toHaveBeenCalledTimes(1);
    expect(harness.llmGenerate).toHaveBeenCalledTimes(1);

    const llmInput = harness.llmGenerate.mock.calls[0]?.[0] as {
      recommendationContext?: {
        query: string;
        selectedTracks: TrackCandidate[];
      };
    };

    expect(llmInput.recommendationContext?.query).toBe("我想听有点忧郁的夜晚开车歌单");
    expect(llmInput.recommendationContext?.selectedTracks).toHaveLength(3);
  });

  test("routes colloquial english playlist requests through recommendation mode", async () => {
    const harness = await createHandleChatHarness();

    const payload = await harness.handleChat("i'm sad can u just play some songs to me");

    expect(payload.controlIntent).toEqual({ type: "none" });
    expect(payload.selectionStatus).toBe("candidate_required");
    expect(payload.candidateTracks?.length).toBeGreaterThan(0);
    expect(harness.ragSelectTrackWithExplanation).toHaveBeenCalledTimes(1);
    expect(harness.llmGenerate).toHaveBeenCalledTimes(1);
  });

  test("keeps pushing recommendation cards when local RAG fails", async () => {
    const harness = await createHandleChatHarness();
    harness.ragSelectTrackWithExplanation.mockRejectedValueOnce(new Error("Embedding failed: timeout"));

    const payload = await harness.handleChat("recommend me a playlist for this mood");

    expect(payload.controlIntent).toEqual({ type: "none" });
    expect(payload.selectionStatus).toBe("candidate_required");
    expect(payload.candidateTracks?.length).toBeGreaterThan(0);
    expect(payload.why_selected?.length).toBeGreaterThan(0);
    expect(harness.ragSelectTrackWithExplanation).toHaveBeenCalledTimes(1);
    expect(harness.llmGenerate).toHaveBeenCalledTimes(1);
  });

  test("keeps regular conversation on the normal LLM branch", async () => {
    const harness = await createHandleChatHarness();

    const payload = await harness.handleChat("hello dj, i had a long day");

    expect(payload.controlIntent).toEqual({ type: "none" });
    expect(payload.reason).toBe("Matched the request and kept the atmosphere.");
    expect(payload.weatherSummary).toBeUndefined();
    expect(harness.fetchWeatherContext).not.toHaveBeenCalled();
    expect(harness.llmGenerate).toHaveBeenCalledTimes(1);
  });
});

