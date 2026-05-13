import { describe, expect, test, vi } from "vitest";

import { buildQqMusicImportPayload, buildQqMusicImportPayloadFromWeb } from "@/lib/qqmusic-api";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("buildQqMusicImportPayload", () => {
  test("collects liked and created playlists from QQMusicApi responses and skips id=0 placeholders", async () => {
    const detail = {
      data: {
        nickname: "listener",
        mymusic: [{ id: "201", num0: 1 }],
        mydiss: [{ dissid: "301" }],
        disslist: [{ id: 0 }]
      }
    };

    const createdSonglist = {
      data: {
        songlist: [
          {
            songname: "If",
            songmid: "mid-if",
            singer: [{ name: "Bread" }],
            albumname: "Mellow Gold",
            albummid: "album-if",
            listenTime: "2026-05-05T23:48:00+08:00",
            interval: 158,
            playCount: 12,
            liked: 1,
            pubtime: "1971",
            genre: "soft rock",
            tags: ["rainy"]
          }
        ]
      }
    };

    const likedSonglist = {
      data: {
        songlist: [
          {
            songname: "Reflection Eternal",
            songmid: "mid-reflection",
            singer: [{ name: "Nujabes" }],
            albumname: "Modal Soul",
            albummid: "album-reflection",
            listenTime: "2026-05-05T14:10:00+08:00",
            interval: 223,
            playCount: 18,
            pubtime: "2005",
            genre: "jazz hip-hop",
            tags: ["focus"]
          }
        ]
      }
    };

    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      const url = String(input);

      if (url.includes("/user/detail")) {
        return jsonResponse(detail);
      }

      if (url.includes("/user/songlist")) {
        return jsonResponse({ data: { mydiss: [{ dissid: "301" }] } });
      }

      if (url.includes("/user/collect/songlist")) {
        return jsonResponse({ data: { list: [] } });
      }

      if (url.includes("id=201")) {
        return jsonResponse(likedSonglist);
      }

      if (url.includes("id=301")) {
        return jsonResponse(createdSonglist);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const payload = await buildQqMusicImportPayload({
        baseUrl: "http://localhost:3300",
        qqNumber: "123456789"
      });

      expect(payload.platform).toBe("qqmusic");
      expect(payload.displayName).toBe("listener");
      expect(payload.listeningHistory).toHaveLength(2);
      expect(payload.listeningHistory[0]?.title).toBe("Reflection Eternal");
      expect(payload.listeningHistory[0]?.liked).toBe(true);
      expect(payload.listeningHistory[0]?.sourceTrackId).toBeDefined();
      expect(payload.listeningHistory[0]?.sourceMid).toBeDefined();
      expect(payload.listeningHistory[0]?.coverUrl).toContain("y.gtimg.cn");
      expect(payload.listeningHistory[0]?.durationMs).toBeGreaterThan(0);
      expect(payload.listeningHistory[0]?.sourcePlaylistId).toBe("201");
      expect(requests.some((request) => request.includes("/songlist?id=0"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("buildQqMusicImportPayloadFromWeb", () => {
  test("paginates collected songlists past the first 200 items", async () => {
    const requests: string[] = [];
    const collectPageOne = {
      data: {
        disslist: Array.from({ length: 200 }, (_, index) => ({ dissid: String(5000 + index) }))
      }
    };
    const collectPageTwo = {
      data: {
        disslist: [{ dissid: "9001" }]
      }
    };
    const playlistPayload = {
      data: {
        songlist: [
          {
            songname: "Track",
            singer: [{ name: "Drake" }],
            albumname: "Night Drive",
            playCount: 1,
            tags: ["rap"]
          }
        ]
      }
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);

      if (url.includes("fcg_user_created_diss")) {
        return jsonResponse({ data: { disslist: [] } });
      }

      if (url.includes("fcg_get_profile_homepage")) {
        return jsonResponse({ data: { nickname: "listener", mymusic: [] } });
      }

      if (url.includes("fcg_get_profile_order_asset")) {
        if (url.includes("sin=0")) {
          return jsonResponse(collectPageOne);
        }

        if (url.includes("sin=200")) {
          return jsonResponse(collectPageTwo);
        }

        throw new Error(`Unexpected collect page: ${url}`);
      }

      if (url.includes("fcg_ucc_getcdinfo_byids_cp")) {
        return jsonResponse(playlistPayload);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const payload = await buildQqMusicImportPayloadFromWeb({
        qqNumber: "641577201"
      });

      expect(payload.displayName).toBe("listener");
      expect(payload.listeningHistory).toHaveLength(201);
      expect(requests.some((request) => request.includes("sin=200"))).toBe(true);
      expect(requests.some((request) => request.includes("disstid=9001"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
