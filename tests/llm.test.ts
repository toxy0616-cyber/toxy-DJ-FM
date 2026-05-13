import { describe, expect, test } from "vitest";

import { buildFallbackResponse, buildLlmTasteContext, hasLiveLlmConfig, resolveDeepSeekConfigFromEnv } from "@/lib/providers/llm";
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

    expect(response.mood).toBe("locked-in");
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
    expect(config.model).toBe("deepseek-v4-flash");
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
