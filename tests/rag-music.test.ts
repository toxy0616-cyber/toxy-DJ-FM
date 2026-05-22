import { beforeEach, describe, expect, test, vi } from "vitest";

import { RAGMusicProvider, extractQueryKeywords, normalizeRecommendationMood } from "@/lib/providers/rag-music";

const searchMock = vi.fn(async () => []);
const embedMock = vi.fn(async () => [0.12, 0.34, 0.56]);

vi.mock("@/lib/vector-store", () => ({
  getVectorStore: () => ({
    search: searchMock
  })
}));

vi.mock("@/lib/music-embedding", async () => {
  const actual = await vi.importActual<typeof import("@/lib/music-embedding")>("@/lib/music-embedding");
  return {
    ...actual,
    embedDescription: (text: string) => embedMock(text)
  };
});

describe("rag-music helpers", () => {
  test("normalizes legacy moods into clear canonical moods", () => {
    expect(normalizeRecommendationMood("rainy")).toBe("sad");
    expect(normalizeRecommendationMood("drained")).toBe("sad");
    expect(normalizeRecommendationMood("locked-in")).toBe("focused");
    expect(normalizeRecommendationMood("defiant")).toBe("energetic");
    expect(normalizeRecommendationMood("happy")).toBe("happy");
  });

  test("extracts broader bilingual keywords", () => {
    const keywords = extractQueryKeywords("我很难过，夜晚开车回家，想听lofi英文歌");

    expect(keywords).toContain("night");
    expect(keywords).toContain("driving");
    expect(keywords).toContain("lofi");
    expect(keywords).toContain("english");
  });
});

describe("rag-music query construction", () => {
  beforeEach(() => {
    searchMock.mockClear();
    embedMock.mockClear();
  });

  test("injects keywords into vector query text", async () => {
    const provider = new RAGMusicProvider({
      provider: "local",
      importedAt: new Date().toISOString(),
      tracks: []
    });

    await (provider as any).searchCandidates(
      {
        mood: "sad",
        energy: "low",
        palette: ["ambient"],
        keywords: ["night", "driving", "rain"],
        avoid: [],
        rationale: "night drive rain"
      },
      5
    );

    const calledText = String(embedMock.mock.calls[0]?.[0] ?? "");
    expect(calledText).toContain("night");
    expect(calledText).toContain("driving");
    expect(calledText).toContain("rain");
  });
});
