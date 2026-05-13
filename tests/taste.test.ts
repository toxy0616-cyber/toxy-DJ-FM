import { describe, expect, test } from "vitest";

import { parseTasteProfile } from "@/lib/taste";

const sampleTaste = `
# Sample

## Profile
Tagline: Your mood is my prompt.
Intro: Intro copy.
DJ Voice: Soft but precise.

## Genres
- Jazz Hip-Hop | 0.95
- Neo-Classical | 0.9

## Artists / Eras / Scenes
Artists: Lamp, Bread
Eras: 90s 华语, 70s soft rock
Scenes: rainy commute, late coding

## Mood Mapping
- rainy => soft rock, city-pop glow
- locked-in => breakbeats, instrumental

## Hard No
- festival EDM drops

## Radio Rules
- 先铺气氛，再解释为什么播这首。

## Signature Playlists
- JAZZ-HIPHOP
`;

describe("parseTasteProfile", () => {
  test("reads fixed sections from taste.md", () => {
    const profile = parseTasteProfile(sampleTaste);

    expect(profile.tagline).toBe("Your mood is my prompt.");
    expect(profile.genres[0]).toEqual({ name: "Jazz Hip-Hop", weight: 0.95 });
    expect(profile.artists).toEqual(["Lamp", "Bread"]);
    expect(profile.moodMappings[0]).toEqual({
      mood: "rainy",
      palette: ["soft rock", "city-pop glow"]
    });
    expect(profile.hardNo).toEqual(["festival EDM drops"]);
  });
});

