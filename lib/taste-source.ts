import type {
  GeneratedTasteArtifacts,
  GenrePreference,
  ListeningRecord,
  TasteImportPayload,
  TasteProfile,
  TasteSourceSnapshot
} from "@/lib/types";
import { dedupeTrimmed } from "@/lib/utils";

const GENRE_HINTS: Record<string, string[]> = {
  "jazz hip-hop": ["lo-fi", "instrumental", "vinyl crackle"],
  "neo-classical": ["piano", "strings", "ambient"],
  "90s mandarin pop": ["nostalgia", "warm vocal", "cassette"],
  "j-rock": ["guitar", "drums", "anthemic"],
  "shibuya-kei": ["city-pop", "playful", "light groove"],
  "post-punk": ["bassline", "tension", "cold glow"],
  hiphop: ["rap", "bars", "low-end"],
  rap: ["808s", "bars", "late-night drive"]
};

const ARTIST_ALIAS_MAP: Record<string, string> = {
  ye: "Kanye West",
  "ye (渚冪埛)": "Kanye West",
  "kanye west": "Kanye West",
  "juice wrld": "Juice WRLD",
  xxxtentacion: "XXXTentacion"
};
const IGNORED_ARTIST_NAMES = new Set(["88rising"]);

function normalize(text?: string) {
  return text?.trim().toLowerCase() ?? "";
}

function dedupeStrings(values: string[], limit = 12) {
  return dedupeTrimmed(values.map((value) => value.trim()).filter(Boolean), limit);
}

function valueWeight(record: ListeningRecord) {
  return Math.max(record.playCount ?? 1, 1);
}

function topEntries(counts: Map<string, number>, limit: number) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

function weightForRank(rank: number) {
  return Number((0.98 - rank * 0.04).toFixed(2));
}

function cleanArtistName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }

  if (IGNORED_ARTIST_NAMES.has(trimmed.toLowerCase())) {
    return "";
  }

  const alias = ARTIST_ALIAS_MAP[trimmed.toLowerCase()];
  if (alias) {
    return alias;
  }

  if (/^ye\s*\(/i.test(trimmed)) {
    return "Kanye West";
  }

  return trimmed;
}

function splitArtists(artistLine: string) {
  return dedupeStrings(
    artistLine
      .split(/\s*(?:,|，|\/|&| feat\. | feat | featuring | ft\. | ft | with | x )\s*/i)
      .map(cleanArtistName),
    20
  );
}

function validRecords(records: ListeningRecord[]) {
  return records.filter((record) => record.title && record.artist);
}

function buildWeightedRecords(payload: TasteImportPayload) {
  const baseRecords = validRecords(payload.listeningHistory);
  const weightedRecords = [...baseRecords];

  for (const overlay of payload.overlays ?? []) {
    const overlayRecords = validRecords(overlay.listeningHistory);
    for (let index = 0; index < overlay.weight; index += 1) {
      weightedRecords.push(...overlayRecords);
    }
  }

  return {
    baseRecords,
    weightedRecords
  };
}

function inferEras(records: ListeningRecord[]) {
  const buckets = new Map<string, number>();

  for (const record of records) {
    const year = record.releaseYear;
    if (typeof year !== "number") {
      continue;
    }

    let era = "20s";
    if (year < 1970) {
      era = "pre-70s";
    } else if (year < 1980) {
      era = "70s";
    } else if (year < 1990) {
      era = "80s";
    } else if (year < 2000) {
      era = "90s";
    } else if (year < 2010) {
      era = "00s";
    } else if (year < 2020) {
      era = "10s";
    }

    buckets.set(era, (buckets.get(era) ?? 0) + 1);
  }

  return topEntries(buckets, 4);
}

function inferScenes(records: ListeningRecord[]) {
  const hourBuckets = new Map<string, number>();

  for (const record of records) {
    if (!record.playedAt) {
      continue;
    }

    const playedAt = new Date(record.playedAt);
    if (Number.isNaN(playedAt.getTime())) {
      continue;
    }

    const hour = playedAt.getHours();
    let scene = "late-night drift";

    if (hour >= 6 && hour < 12) {
      scene = "morning reset";
    } else if (hour >= 12 && hour < 18) {
      scene = "focus window";
    } else if (hour >= 18 && hour < 22) {
      scene = "evening commute";
    }

    hourBuckets.set(scene, (hourBuckets.get(scene) ?? 0) + 1);
  }

  const inferred = topEntries(hourBuckets, 4);
  return inferred.length > 0 ? inferred : ["late-night drift", "focus window", "rainy commute"];
}

function buildGenreCounts(records: ListeningRecord[]) {
  const counts = new Map<string, number>();

  for (const record of records) {
    const increment = valueWeight(record);
    const genres = record.genres ?? [];

    for (const genre of genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + increment);
    }

    if (genres.length === 0) {
      for (const tag of record.tags ?? []) {
        if (GENRE_HINTS[normalize(tag)]) {
          counts.set(tag, (counts.get(tag) ?? 0) + increment);
        }
      }
    }
  }

  return counts;
}

function buildArtistCounts(records: ListeningRecord[]) {
  const counts = new Map<string, number>();

  for (const record of records) {
    const increment = valueWeight(record);
    for (const artist of splitArtists(record.artist)) {
      counts.set(artist, (counts.get(artist) ?? 0) + increment);
    }
  }

  return counts;
}

function buildTagCounts(records: ListeningRecord[]) {
  const counts = new Map<string, number>();

  for (const record of records) {
    const increment = valueWeight(record);
    for (const tag of record.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + increment);
    }
  }

  return counts;
}

function inferMoodHints(records: ListeningRecord[], topGenres: string[]) {
  const tagBag = buildTagCounts(records);
  const genreBag = buildGenreCounts(records);
  const combined = new Map<string, number>();

  for (const [key, value] of [...tagBag.entries(), ...genreBag.entries()]) {
    combined.set(key, (combined.get(key) ?? 0) + value);
  }

  const picks = topEntries(combined, 12);
  const source = dedupeStrings([...picks, ...topGenres]);
  const moodLookup: Record<string, string[]> = {
    rainy: ["soft rock", "window-side intimacy", "analog hiss"],
    lockedIn: ["instrumental hip-hop", "minimal lyric distraction", "steady pulse"],
    drained: ["neo-classical", "glass piano", "slow breathing space"],
    romantic: ["city-pop glow", "late chorus", "soft focus"],
    defiant: ["post-punk edge", "bass tension", "sharp drums"]
  };

  return {
    rainy: dedupeStrings(source.slice(0, 3).concat(moodLookup.rainy)),
    lockedIn: dedupeStrings(source.slice(1, 4).concat(moodLookup.lockedIn)),
    drained: dedupeStrings(source.slice(2, 5).concat(moodLookup.drained)),
    romantic: dedupeStrings(source.slice(0, 3).concat(moodLookup.romantic)),
    defiant: dedupeStrings(source.slice(3, 6).concat(moodLookup.defiant))
  };
}

function inferHardNo(records: ListeningRecord[], payload: TasteImportPayload) {
  const dislikedTracks = payload.dislikes ?? [];
  const skippedTerms = new Map<string, number>();

  for (const record of records) {
    if (!record.skipped) {
      continue;
    }

    for (const genre of record.genres ?? []) {
      skippedTerms.set(genre, (skippedTerms.get(genre) ?? 0) + 1);
    }

    for (const tag of record.tags ?? []) {
      skippedTerms.set(tag, (skippedTerms.get(tag) ?? 0) + 1);
    }
  }

  return dedupeStrings([
    ...dislikedTracks,
    ...topEntries(skippedTerms, 4).map((item) => `avoid ${item}`)
  ]);
}

function genrePreferences(records: ListeningRecord[]): GenrePreference[] {
  return [...buildGenreCounts(records).entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([name], index) => ({
      name,
      weight: weightForRank(index)
    }));
}

function mergeArtistHighlights(globalArtists: string[], focusArtists: string[]) {
  return dedupeStrings(
    [
      globalArtists[0],
      globalArtists[1],
      focusArtists[0],
      focusArtists[1],
      globalArtists[2],
      focusArtists[2],
      focusArtists[3],
      globalArtists[3],
      ...globalArtists,
      ...focusArtists
    ].filter(Boolean),
    8
  );
}

function focusArtistsFromOverlays(payload: TasteImportPayload) {
  const overlayRecords = payload.overlays?.flatMap((overlay) => overlay.listeningHistory) ?? [];
  const counts = buildArtistCounts(validRecords(overlayRecords));
  return topEntries(counts, 8);
}

function buildFocusRules(payload: TasteImportPayload) {
  const focusArtists = focusArtistsFromOverlays(payload);
  if (focusArtists.length === 0) {
    return [];
  }

  return [
    `Keep the rap through-line active with ${focusArtists.slice(0, 4).join(" / ")} when the mood can hold more edge.`,
    `Do not let the rap lane erase the wider palette; blend it back into the main station identity.`
  ];
}

function buildRadioRules(records: ListeningRecord[], topGenres: string[], scenes: string[], payload: TasteImportPayload) {
  const avgEnergy =
    records.reduce((total, record) => {
      if (record.energy === "high") {
        return total + 2;
      }

      if (record.energy === "medium") {
        return total + 1;
      }

      return total;
    }, 0) / Math.max(records.length, 1);

  const rules = [
    `Start from ${topGenres.slice(0, 2).join(" / ") || "the strongest repeat textures"}, then move deeper with the mood.`,
    "If the user gives only a feeling, hold the feeling first and explain the programming choice second.",
    avgEnergy < 0.9
      ? "Default to controlled energy ramps; do not spike the station too fast."
      : "This taste can take stronger momentum shifts when the rhythm feels earned.",
    scenes.includes("late-night drift")
      ? "At night, protect the sense of air, warmth, and emotional afterglow."
      : "In daytime rotation, keep transitions smooth and avoid abrupt tonal cuts."
  ];

  return dedupeStrings([...rules, ...buildFocusRules(payload)]);
}

function buildSignaturePlaylists(topGenres: string[], payload: TasteImportPayload) {
  const focusArtists = focusArtistsFromOverlays(payload);
  const defaults =
    topGenres.length === 0
      ? ["late-night drift", "focus window", "rainy commute"]
      : topGenres.slice(0, 4).map((genre) => genre.toUpperCase());

  if (focusArtists.length === 0) {
    return defaults;
  }

  return dedupeStrings([...defaults, `RAP THREAD: ${focusArtists.slice(0, 3).join(" / ")}`], 6);
}

function buildTagline(payload: TasteImportPayload, topArtists: string[], topGenres: string[]) {
  const artist = topArtists[0] ?? payload.displayName ?? "you";
  const genre = topGenres[0] ?? "late-night radio";
  return `${artist} tuned to ${genre}`;
}

function buildIntro(recordCount: number, topArtists: string[], topGenres: string[], payload: TasteImportPayload) {
  const artistText = topArtists.slice(0, 4).join(", ") || "a steady cast of repeat artists";
  const genreText = topGenres.slice(0, 3).join(", ") || "a few recurring textures";
  const focusArtists = focusArtistsFromOverlays(payload);

  if (focusArtists.length === 0) {
    return `Built from ${recordCount} imported records, with ${artistText} and ${genreText} setting the station core.`;
  }

  return `Built from ${recordCount} imported records, with ${artistText} holding the wide-angle taste and ${focusArtists.slice(0, 4).join(", ")} sharpening the rap line.`;
}

function buildDjVoice(topGenres: string[], scenes: string[], payload: TasteImportPayload) {
  const genreText = topGenres[0] ?? "late-night radio";
  const sceneText = scenes[0] ?? "late-night drift";
  const focusArtists = focusArtistsFromOverlays(payload);

  if (focusArtists.length === 0) {
    return `Speak like ${genreText} standing inside ${sceneText}: attentive first, then more direct when the user wants momentum.`;
  }

  return `Speak like ${genreText} inside ${sceneText}, but keep a rap undercurrent ready for ${focusArtists.slice(0, 3).join(" / ")}.`;
}

function buildMarkdown(profile: TasteProfile) {
  return [
    "# Toxy Taste File",
    "",
    "## Profile",
    `Tagline: ${profile.tagline}`,
    `Intro: ${profile.intro}`,
    `DJ Voice: ${profile.djVoice}`,
    "",
    "## Genres",
    ...profile.genres.map((genre) => `- ${genre.name} | ${genre.weight.toFixed(2)}`),
    "",
    "## Artists / Eras / Scenes",
    `Artists: ${profile.artists.join(", ")}`,
    `Eras: ${profile.eras.join(", ")}`,
    `Scenes: ${profile.scenes.join(", ")}`,
    "",
    "## Mood Mapping",
    ...profile.moodMappings.map((item) => `- ${item.mood} => ${item.palette.join(", ")}`),
    "",
    "## Hard No",
    ...profile.hardNo.map((item) => `- ${item}`),
    "",
    "## Radio Rules",
    ...profile.radioRules.map((item) => `- ${item}`),
    "",
    "## Signature Playlists",
    ...profile.signaturePlaylists.map((item) => `- ${item}`)
  ].join("\n");
}

export function generateTasteArtifacts(payload: TasteImportPayload): GeneratedTasteArtifacts {
  const { baseRecords, weightedRecords } = buildWeightedRecords(payload);
  const globalTopArtists = topEntries(buildArtistCounts(baseRecords), 8);
  const weightedTopArtists = topEntries(buildArtistCounts(weightedRecords), 8);
  const topArtists = mergeArtistHighlights(weightedTopArtists, focusArtistsFromOverlays(payload).length > 0
    ? focusArtistsFromOverlays(payload)
    : globalTopArtists);
  const topGenres = topEntries(buildGenreCounts(weightedRecords), 6);
  const topTags = topEntries(buildTagCounts(weightedRecords), 6);
  const eras = inferEras(baseRecords);
  const scenes = inferScenes(baseRecords);
  const moodHints = inferMoodHints(weightedRecords, topGenres);
  const hardNo = inferHardNo(baseRecords, payload);
  const genres = genrePreferences(weightedRecords);

  const profile: TasteProfile = {
    tagline: buildTagline(payload, topArtists, topGenres),
    intro: buildIntro(baseRecords.length, topArtists, topGenres, payload),
    djVoice: buildDjVoice(topGenres, scenes, payload),
    genres,
    artists: topArtists,
    eras,
    scenes,
    moodMappings: [
      { mood: "rainy", palette: moodHints.rainy },
      { mood: "locked-in", palette: moodHints.lockedIn },
      { mood: "drained", palette: moodHints.drained },
      { mood: "romantic", palette: moodHints.romantic },
      { mood: "defiant", palette: moodHints.defiant }
    ],
    hardNo,
    radioRules: buildRadioRules(weightedRecords, topGenres, scenes, payload),
    signaturePlaylists: buildSignaturePlaylists(topGenres, payload),
    rawMarkdown: ""
  };

  const snapshot: TasteSourceSnapshot = {
    platform: payload.platform,
    displayName: payload.displayName,
    sourceName: payload.sourceName,
    importedAt: new Date().toISOString(),
    recordCount: baseRecords.length,
    likedCount: baseRecords.filter((record) => record.liked).length,
    skippedCount: baseRecords.filter((record) => record.skipped).length,
    topTracks: [...baseRecords]
      .sort((left, right) => (right.playCount ?? 1) - (left.playCount ?? 1))
      .slice(0, 8)
      .map((record) => `${record.title} - ${record.artist}`),
    topArtists,
    topGenres,
    topTags,
    moodHints: dedupeStrings([...topGenres, ...topTags]).slice(0, 8)
  };

  const markdown = buildMarkdown(profile);

  return {
    profile: {
      ...profile,
      rawMarkdown: markdown
    },
    markdown,
    snapshot
  };
}
