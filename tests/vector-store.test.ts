import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VectorStore } from "@/lib/vector-store";
import type { MusicVector } from "@/lib/music-embedding";

describe("vector-store", () => {
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore();
  });

  afterEach(() => {
    store = null as any;
  });

  describe("VectorStore", () => {
    it("should initialize with empty vectors", async () => {
      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should add vectors", async () => {
      const vectors: MusicVector[] = [
        {
          trackId: "track-1",
          vector: [0.1, 0.2, 0.3],
          metadata: {
            title: "Song 1",
            artist: "Artist 1",
            album: "Album 1",
            energy: "high",
            mood: "happy",
            tags: ["pop"],
            provider: "local",
            providerTrackId: "1"
          }
        }
      ];

      await store.addVectors(vectors);
      const count = await store.count();

      expect(count).toBe(1);
    });

    it("should search for similar vectors", async () => {
      const vectors: MusicVector[] = [
        {
          trackId: "track-1",
          vector: [1, 0, 0],
          metadata: {
            title: "Song 1",
            artist: "Artist 1",
            album: "Album 1",
            energy: "high",
            mood: "happy",
            tags: ["pop"],
            provider: "local",
            providerTrackId: "1"
          }
        },
        {
          trackId: "track-2",
          vector: [0.9, 0.1, 0],
          metadata: {
            title: "Song 2",
            artist: "Artist 2",
            album: "Album 2",
            energy: "medium",
            mood: "neutral",
            tags: ["rock"],
            provider: "local",
            providerTrackId: "2"
          }
        }
      ];

      await store.addVectors(vectors);

      const results = await store.search([1, 0, 0], 1);

      expect(results).toHaveLength(1);
      expect(results[0].trackId).toBe("track-1");
      expect(results[0].similarity).toBeCloseTo(1, 2);
    });

    it("should return empty array for empty store", async () => {
      const results = await store.search([1, 0, 0], 10);

      expect(results).toHaveLength(0);
    });

    it("should respect topK parameter", async () => {
      const vectors: MusicVector[] = Array.from({ length: 10 }, (_, i) => ({
        trackId: `track-${i}`,
        vector: [Math.cos((i * Math.PI) / 5), Math.sin((i * Math.PI) / 5), 0],
        metadata: {
          title: `Song ${i}`,
          artist: `Artist ${i}`,
          album: `Album ${i}`,
          energy: "high" as const,
          mood: "happy",
          tags: [],
          provider: "local" as const,
          providerTrackId: String(i)
        }
      }));

      await store.addVectors(vectors);

      const results = await store.search([1, 0, 0], 3);

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should get track by ID", async () => {
      const vectors: MusicVector[] = [
        {
          trackId: "track-1",
          vector: [0.1, 0.2, 0.3],
          metadata: {
            title: "Song 1",
            artist: "Artist 1",
            album: "Album 1",
            energy: "high",
            mood: "happy",
            tags: ["pop"],
            provider: "local",
            providerTrackId: "1"
          }
        }
      ];

      await store.addVectors(vectors);

      const track = await store.getTrack("track-1");

      expect(track).toBeDefined();
      expect(track?.metadata.title).toBe("Song 1");
    });

    it("should return null for non-existent track", async () => {
      const track = await store.getTrack("non-existent");

      expect(track).toBeNull();
    });

    it("should clear all vectors", async () => {
      const vectors: MusicVector[] = [
        {
          trackId: "track-1",
          vector: [0.1, 0.2, 0.3],
          metadata: {
            title: "Song 1",
            artist: "Artist 1",
            album: "Album 1",
            energy: "high",
            mood: "happy",
            tags: ["pop"],
            provider: "local",
            providerTrackId: "1"
          }
        }
      ];

      await store.addVectors(vectors);
      expect(await store.count()).toBe(1);

      await store.clear();

      expect(await store.count()).toBe(0);
    });
  });
});
