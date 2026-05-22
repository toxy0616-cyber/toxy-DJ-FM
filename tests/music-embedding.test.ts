import { describe, it, expect } from "vitest";
import { generateMusicDescription, cosineSimilarity } from "@/lib/music-embedding";

describe("music-embedding", () => {
  describe("generateMusicDescription", () => {
    it("should generate description from track", () => {
      const track = {
        provider: "local" as const,
        providerTrackId: "test-123",
        title: "Moonlight Sonata",
        artist: "Ludwig van Beethoven",
        album: "Classical Masterpieces",
        energy: "low" as const,
        mood: "romantic",
        tags: ["classical", "piano"],
        searchableText: "moonlight sonata",
        importedAt: new Date().toISOString(),
        playable: true
      };

      const description = generateMusicDescription(track);

      expect(description).toContain("Moonlight Sonata");
      expect(description).toContain("Ludwig van Beethoven");
      expect(description).toContain("classical");
      expect(description).toContain("romantic");
    });

    it("should include enriched metadata when provided", () => {
      const track = {
        provider: "local" as const,
        providerTrackId: "test-123",
        title: "Bohemian Rhapsody",
        artist: "Queen",
        album: "A Night at the Opera",
        energy: "high" as const,
        mood: "defiant",
        tags: ["rock"],
        searchableText: "bohemian rhapsody",
        importedAt: new Date().toISOString(),
        playable: true
      };

      const enriched = {
        genres: ["Rock", "Hard Rock"],
        tags: ["operatic", "progressive"],
        description: "An iconic rock opera piece",
        era: "1975"
      };

      const description = generateMusicDescription(track, enriched);

      expect(description).toContain("Bohemian Rhapsody");
      expect(description).toContain("Rock");
      expect(description).toContain("1975");
      expect(description).toContain("operatic");
    });
  });

  describe("cosineSimilarity", () => {
    it("should calculate cosine similarity between vectors", () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0, 0];

      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBeCloseTo(1, 2);
    });

    it("should return 0 for orthogonal vectors", () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];

      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBeCloseTo(0, 2);
    });

    it("should handle opposite vectors", () => {
      const vec1 = [1, 0, 0];
      const vec2 = [-1, 0, 0];

      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBeCloseTo(-1, 2);
    });

    it("should throw error for mismatched dimensions", () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0];

      expect(() => cosineSimilarity(vec1, vec2)).toThrow();
    });
  });
});
