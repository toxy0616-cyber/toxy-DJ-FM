import { describe, expect, test } from "vitest";

import { normalizeQqMusicPayload, normalizeTasteImportPayload } from "@/lib/import-payload";

describe("normalizeQqMusicPayload", () => {
  test("maps qq music raw songlist payload into listening history", () => {
    const payload = normalizeQqMusicPayload({
      platform: "qqmusic",
      sourceName: "qqmusic-export",
      data: {
        songlist: [
          {
            songname: "晴天",
            singer: [{ name: "周杰伦" }],
            albumname: "叶惠美",
            listenTime: "2026-05-06T20:30:00+08:00",
            playCount: 14,
            liked: 1,
            pubtime: "2003-07-31",
            genre: "mandopop",
            tags: ["night", "repeat"],
            energy: "medium"
          }
        ]
      }
    });

    expect(payload.platform).toBe("qqmusic");
    expect(payload.listeningHistory).toHaveLength(1);
    expect(payload.listeningHistory[0]).toMatchObject({
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      playCount: 14,
      liked: true,
      releaseYear: 2003,
      genres: ["mandopop"],
      tags: ["night", "repeat"],
      energy: "medium",
      platform: "qqmusic"
    });
    expect(payload.listeningHistory[0]?.playedAt).toContain("2026-05-06");
  });

  test("keeps normalized payloads working for qq music", () => {
    const payload = normalizeTasteImportPayload({
      platform: "qqmusic",
      displayName: "listener",
      listeningHistory: [
        {
          title: "安静",
          artist: "周杰伦",
          playCount: 8
        }
      ]
    });

    expect(payload.displayName).toBe("listener");
    expect(payload.listeningHistory[0]).toMatchObject({
      title: "安静",
      artist: "周杰伦",
      playCount: 8
    });
  });
});
