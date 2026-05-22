import { describe, expect, test, vi } from "vitest";

import {
  buildFallbackResponse,
  buildLlmTasteContext,
  buildRetrievedLocalContext,
  hasLiveLlmConfig,
  rankLocalRagSnippets,
  localJsonFileIO,
  resolveDeepSeekConfigFromEnv
} from "@/lib/providers/llm";
import type { RadioState, TasteProfile } from "@/lib/types";

const profile: TasteProfile = {
  tagline: "Your mood is my prompt.",
  intro: "Intro",
  djVoice: "Voice",
  genres: [{ name: "Jazz Hip-Hop", weight: 0.95 }],
  artists: ["Lamp"],
  eras: ["90s mandarin"],
  scenes: ["rainy cafe"],
  moodMappings: [
    { mood: "rainy", palette: ["soft rock", "window-side intimacy"] },
    { mood: "locked-in", palette: ["instrumental hip-hop", "minimal lyric distraction"] }
  ],
  hardNo: ["festival EDM drops"],
  radioRules: [],
  signaturePlaylists: [],
  rawMarkdown: "# Toxy Taste File\n\n## Profile\nTagline: Your mood is my prompt."
};

const radioState: RadioState = {
  nowPlaying: {
    id: "if-bread",
    title: "If",
    artist: "Bread",
    album: "Test",
    durationLabel: "2:00",
    mood: "rainy",
    energy: "low",
    tags: ["soft-rock"],
    coverUrl: "",
    streamUrl: "",
    provider: "demo",
    providerTrackId: "if-bread",
    playable: true
  },
  queue: [],
  mood: "rainy",
  onAirLine: "Test",
  lastReason: "Test",
  updatedAt: new Date().toISOString(),
  recentMoods: ["rainy"],
  recentTrackKeys: [],
  chatHistory: [],
  activeSwitchToken: null
};

describe("buildFallbackResponse", () => {
  test("maps coding prompts to a focus-oriented mood", () => {
    const response = buildFallbackResponse({
      profile,
      radioState,
      runtimeContext: {
        dayPart: "late-night",
        dayName: "Tuesday",
        localTime: "02:12",
        currentMood: "rainy",
        recentMessages: []
      },
      userMessage: "I need to focus and keep coding for another hour."
    });

    expect(response.mood).toBe("focused");
    expect(response.trackIntent.energy).toBe("medium");
    expect(response.reply).toContain("02:12");
  });

  test("describes selected command-driven tracks clearly", () => {
    const response = buildFallbackResponse({
      profile,
      radioState,
      runtimeContext: {
        dayPart: "late-night",
        dayName: "Tuesday",
        localTime: "02:12",
        currentMood: "rainy",
        recentMessages: []
      },
      userMessage: "play the second song",
      resolvedControlIntent: { type: "queue_index", queueIndex: 2 },
      selectionStatus: "picked",
      selectedTrack: {
        ...radioState.nowPlaying,
        id: "q2",
        title: "Reflection Eternal",
        artist: "Nujabes",
        providerTrackId: "q2"
      }
    });

    expect(response.reason).toContain("Reflection Eternal");
    expect(response.controlIntent).toEqual({ type: "queue_index", queueIndex: 2 });
  });
});

describe("resolveDeepSeekConfigFromEnv", () => {
  test("uses the DeepSeek defaults", () => {
    const config = resolveDeepSeekConfigFromEnv({
      NODE_ENV: "test",
      DEEPSEEK_API_KEY: "test-key"
    });

    expect(config.baseUrl).toBe("https://api.deepseek.com");
    expect(config.model).toBe("deepseek-chat");
  });

  test("keeps explicit overrides", () => {
    const config = resolveDeepSeekConfigFromEnv({
      NODE_ENV: "test",
      DEEPSEEK_BASE_URL: "https://example.com/v1",
      DEEPSEEK_MODEL: "deepseek-chat"
    });

    expect(config.baseUrl).toBe("https://example.com/v1");
    expect(config.model).toBe("deepseek-chat");
  });

  test("reports whether live llm config is available", () => {
    expect(hasLiveLlmConfig({ NODE_ENV: "test", DEEPSEEK_API_KEY: "x" })).toBe(true);
    expect(hasLiveLlmConfig({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("buildLlmTasteContext", () => {
  test("includes the full taste markdown when available", () => {
    const context = buildLlmTasteContext(profile);

    expect(context).toContain("Genres: Jazz Hip-Hop(0.95)");
    expect(context).toContain("Full taste file:");
    expect(context).toContain("# Toxy Taste File");
  });
});

describe("lightweight local rag", () => {
  test("retrieves top-k snippets from taste source, chat history, and recent plays", async () => {
    const result = await buildRetrievedLocalContext(
      {
        userMessage: "play rain or history and keep the mood soft",
        radioState: {
          ...radioState,
          chatHistory: [
            {
              id: "chat-1",
              role: "user",
              text: "please play rain",
              createdAt: "2026-05-12T01:00:00.000Z"
            },
            {
              id: "chat-2",
              role: "assistant",
              text: "I can queue History for you",
              createdAt: "2026-05-12T01:00:05.000Z"
            }
          ],
          recentTrackKeys: ["local:shining-rain", "local:history-rich-brian"]
        }
      },
      {
        tasteSourceSnapshot: {
          platform: "local",
          importedAt: "2026-05-11T07:46:31.587Z",
          recordCount: 590,
          likedCount: 0,
          skippedCount: 0,
          topTracks: ["History - 88rising _ Rich Brian"],
          topArtists: ["Imagine Dragons"],
          topGenres: [],
          topTags: ["soft"],
          moodHints: ["rainy"]
        },
        playableLibrarySnapshot: {
          provider: "local",
          importedAt: "2026-05-11T07:46:31.563Z",
          tracks: [
            {
              provider: "local",
              providerTrackId: "shining-rain",
              title: "Rain",
              artist: "Shining",
              album: "music",
              energy: "low",
              mood: "rainy",
              tags: ["soft"],
              searchableText: "rain shining",
              importedAt: "2026-05-11T07:46:31.563Z",
              playable: true
            },
            {
              provider: "local",
              providerTrackId: "history-rich-brian",
              title: "History",
              artist: "88rising _ Rich Brian",
              album: "music",
              energy: "low",
              mood: "drained",
              tags: [],
              searchableText: "history rich brian",
              importedAt: "2026-05-11T07:46:31.563Z",
              playable: true
            }
          ]
        }
      }
    );

    expect(result.snippets.length).toBeLessThanOrEqual(6);
    expect(result.promptBlock).toContain("[chat-history]");
    expect(result.promptBlock).toContain("[recent-plays]");
    expect(result.promptBlock).toContain("[taste-source]");
  });

  test("prioritizes lexical matches and prefers newer snippets on tie", () => {
    const ranked = rankLocalRagSnippets("rain shining", [
      { source: "chat-history", text: "user: random topic unrelated", recencyIndex: 0 },
      { source: "recent-plays", text: "Recent play: Rain - Shining", recencyIndex: 4 },
      { source: "chat-history", text: "user: rain shining please", recencyIndex: 2 }
    ]);

    expect(ranked[0]?.text).toContain("rain shining");
    expect(ranked[1]?.text).toContain("Rain - Shining");

    const tieRanked = rankLocalRagSnippets("rain", [
      { source: "chat-history", text: "user: rain", recencyIndex: 3 },
      { source: "chat-history", text: "assistant: rain", recencyIndex: 0 }
    ]);

    expect(tieRanked[0]?.recencyIndex).toBe(0);
  });

  test("degrades safely when local json is missing or invalid", async () => {
    const readSpy = vi.spyOn(localJsonFileIO, "readFile").mockImplementation(async (filePath) => {
      const target = String(filePath);
      if (target.endsWith("taste-source.json")) {
        throw new Error("missing file");
      }

      return "{invalid-json";
    });
    try {
      const result = await buildRetrievedLocalContext({
        userMessage: "hello dj",
        radioState: {
          ...radioState,
          chatHistory: [],
          recentTrackKeys: []
        }
      });

      expect(result.promptBlock).toBe("none");
      expect(result.snippets).toHaveLength(0);
    } finally {
      readSpy.mockRestore();
    }
  });

  test("caps snippet and total injected length budgets", async () => {
    const longLine = "rain ".repeat(100);
    const result = await buildRetrievedLocalContext(
      {
        userMessage: "rain",
        radioState: {
          ...radioState,
          chatHistory: [
            {
              id: "chat-long",
              role: "user",
              text: longLine,
              createdAt: "2026-05-12T01:00:00.000Z"
            }
          ],
          recentTrackKeys: []
        }
      },
      {
        maxSnippetChars: 40,
        maxTotalChars: 60,
        tasteSourceSnapshot: null,
        playableLibrarySnapshot: null
      }
    );

    expect(result.snippets[0]?.text.length).toBeLessThanOrEqual(40);
    const totalSnippetChars = result.snippets.reduce((total, snippet) => total + snippet.text.length, 0);
    expect(totalSnippetChars).toBeLessThanOrEqual(60);
  });
});
