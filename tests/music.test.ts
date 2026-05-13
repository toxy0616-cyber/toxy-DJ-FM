import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/music-library", async () => {
  const actual = await vi.importActual<typeof import("@/lib/music-library")>("@/lib/music-library");
  return {
    ...actual,
    readPlayableLibrary: vi.fn()
  };
});

import { readPlayableLibrary } from "@/lib/music-library";
import { getMusicProvider } from "@/lib/providers/music";
import type { PlayableLibrarySnapshot, TasteProfile } from "@/lib/types";

const tasteProfile: TasteProfile = {
  tagline: "Tagline",
  intro: "Intro",
  djVoice: "Voice",
  genres: [{ name: "Jazz Hip-Hop", weight: 0.9 }],
  artists: [],
  eras: [],
  scenes: [],
  moodMappings: [{ mood: "defiant", palette: ["drums", "night"] }],
  hardNo: ["festival EDM drops"],
  radioRules: [],
  signaturePlaylists: [],
  rawMarkdown: ""
};

const playableLibrary: PlayableLibrarySnapshot = {
  provider: "qqmusic",
  importedAt: new Date().toISOString(),
  tracks: [
    {
      provider: "qqmusic",
      providerTrackId: "track-1",
      sourceMid: "mid-1",
      title: "Reflection Eternal",
      artist: "Nujabes",
      album: "Modal Soul",
      durationMs: 220000,
      coverUrl: "https://example.com/cover.jpg",
      energy: "medium",
      mood: "locked-in",
      tags: ["jazz hip-hop", "focus"],
      searchableText: "reflection eternal nujabes modal soul jazz hip-hop focus",
      importedAt: new Date().toISOString(),
      playable: true
    },
    {
      provider: "qqmusic",
      providerTrackId: "track-2",
      sourceMid: "mid-2",
      title: "Mirror Run",
      artist: "Club Null",
      album: "Night Drive",
      durationMs: 186000,
      coverUrl: "https://example.com/cover-2.jpg",
      energy: "high",
      mood: "defiant",
      tags: ["festival", "drops"],
      searchableText: "mirror run club null night drive festival drops",
      importedAt: new Date().toISOString(),
      playable: true
    }
  ]
};

describe("HybridMusicProvider", () => {
  beforeEach(() => {
    vi.mocked(readPlayableLibrary).mockReset();
  });

  test("filters out tracks that conflict with hard-no vocabulary", async () => {
    vi.mocked(readPlayableLibrary).mockResolvedValue(null);

    const provider = getMusicProvider();
    const track = await provider.pickTrack(
      {
        mood: "defiant",
        energy: "high",
        palette: ["festival", "drops"],
        avoid: tasteProfile.hardNo,
        rationale: "User wants a defiant push."
      },
      tasteProfile
    );

    expect(track.id).not.toBe("mirror-run");
  });

  test("prefers imported qq library over demo tracks when available", async () => {
    vi.mocked(readPlayableLibrary).mockResolvedValue(playableLibrary);

    const provider = getMusicProvider();
    const track = await provider.pickTrack(
      {
        mood: "locked-in",
        energy: "medium",
        palette: ["focus"],
        avoid: [],
        rationale: "Need a study track."
      },
      tasteProfile
    );

    expect(track.provider).toBe("qqmusic");
    expect(track.title).toBe("Reflection Eternal");
    expect(track.streamUrl).toContain("/api/audio/qq/track-1");
  });

  test("supports title and artist query search for imported tracks", async () => {
    vi.mocked(readPlayableLibrary).mockResolvedValue(playableLibrary);

    const provider = getMusicProvider();
    const matches = await provider.search("Nujabes Reflection Eternal");

    expect(matches[0]?.title).toBe("Reflection Eternal");
    expect(matches[0]?.provider).toBe("qqmusic");
  });
});

