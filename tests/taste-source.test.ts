import { describe, expect, test } from "vitest";

import { generateTasteArtifacts } from "@/lib/taste-source";

describe("generateTasteArtifacts", () => {
  test("builds taste.md content from listening history payload", () => {
    const artifacts = generateTasteArtifacts({
      platform: "netease",
      displayName: "mmguo",
      dislikes: ["festival EDM drops"],
      listeningHistory: [
        {
          title: "If",
          artist: "Bread",
          playCount: 9,
          liked: true,
          genres: ["soft rock"],
          tags: ["rainy", "gentle"],
          releaseYear: 1971,
          playedAt: "2026-05-05T23:48:00+08:00"
        },
        {
          title: "Reflection Eternal",
          artist: "Nujabes",
          playCount: 11,
          liked: true,
          genres: ["jazz hip-hop"],
          tags: ["focus", "vinyl"],
          releaseYear: 2005,
          playedAt: "2026-05-05T14:10:00+08:00"
        },
        {
          title: "Mirror Run",
          artist: "Club Null",
          playCount: 2,
          skipped: true,
          genres: ["festival EDM"],
          tags: ["drops", "hype"],
          releaseYear: 2020
        }
      ]
    });

    expect(artifacts.profile.artists).toContain("Nujabes");
    expect(artifacts.profile.genres[0]?.name).toBe("jazz hip-hop");
    expect(artifacts.profile.hardNo.join(" ")).toContain("festival EDM drops");
    expect(artifacts.markdown).toContain("## Genres");
    expect(artifacts.snapshot.platform).toBe("netease");
  });

  test("keeps the main taste wide while pulling rap overlays into the primary profile", () => {
    const artifacts = generateTasteArtifacts({
      platform: "qqmusic",
      displayName: "Lil beeb",
      listeningHistory: [
        {
          title: "Sugar, We're Goin Down",
          artist: "Fall Out Boy",
          genres: ["pop punk"],
          playCount: 4
        },
        {
          title: "Believer",
          artist: "Imagine Dragons",
          genres: ["arena pop"],
          playCount: 4
        },
        {
          title: "Yellow",
          artist: "Coldplay",
          genres: ["alt pop"],
          playCount: 3
        }
      ],
      overlays: [
        {
          name: "rap-focus",
          weight: 2,
          listeningHistory: [
            {
              title: "God's Plan",
              artist: "Drake",
              genres: ["rap"],
              tags: ["englishbaby"]
            },
            {
              title: "History",
              artist: "88rising, Rich Brian",
              genres: ["rap"],
              tags: ["englishbaby"]
            },
            {
              title: "One Man Can Change The World",
              artist: "Big Sean, Ye (渚冪埛), John Legend",
              genres: ["rap"],
              tags: ["englishbaby"]
            }
          ]
        }
      ]
    });

    expect(artifacts.profile.artists).toEqual(
      expect.arrayContaining(["Fall Out Boy", "Imagine Dragons", "Drake", "Rich Brian", "Kanye West"])
    );
    expect(artifacts.profile.radioRules.join(" ")).toContain("rap");
    expect(artifacts.markdown).toContain("RAP THREAD:");
  });
});
