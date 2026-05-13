import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/music-library", () => ({
  readPlayableLibrary: vi.fn()
}));

import { readPlayableLibrary } from "@/lib/music-library";
import { resolveQqStreamUrl } from "@/lib/qqmusic-stream";

describe("resolveQqStreamUrl", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.mocked(readPlayableLibrary).mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("builds a playable qq stream url from the stored local library snapshot", async () => {
    vi.mocked(readPlayableLibrary).mockResolvedValue({
      provider: "qqmusic",
      importedAt: new Date().toISOString(),
      sessionCookie: "uin=1; qqmusic_key=abc",
      tracks: [
        {
          provider: "qqmusic",
          providerTrackId: "track-1",
          sourceMid: "mid-1",
          title: "Track",
          artist: "Artist",
          album: "Album",
          durationMs: 180000,
          coverUrl: "https://example.com/cover.jpg",
          energy: "medium",
          mood: "locked-in",
          tags: ["focus"],
          searchableText: "track artist album focus",
          importedAt: new Date().toISOString(),
          playable: true
        }
      ]
    });

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          req_1: {
            data: {
              midurlinfo: [{ purl: "C400mid-1.m4a?fromtag=0" }],
              sip: ["https://isure.stream.qqmusic.qq.com/"]
            }
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }) as typeof fetch;

    const result = await resolveQqStreamUrl("track-1");

    expect(result.url).toBe("https://isure.stream.qqmusic.qq.com/C400mid-1.m4a?fromtag=0");
    expect(result.sessionCookie).toContain("qqmusic_key");
  });

  test("fails clearly when the qq session cookie is missing", async () => {
    vi.mocked(readPlayableLibrary).mockResolvedValue({
      provider: "qqmusic",
      importedAt: new Date().toISOString(),
      tracks: [
        {
          provider: "qqmusic",
          providerTrackId: "track-1",
          title: "Track",
          artist: "Artist",
          album: "Album",
          energy: "medium",
          mood: "locked-in",
          tags: ["focus"],
          searchableText: "track artist album focus",
          importedAt: new Date().toISOString(),
          playable: true
        }
      ]
    });

    await expect(resolveQqStreamUrl("track-1")).rejects.toThrow("session cookie");
  });
});

