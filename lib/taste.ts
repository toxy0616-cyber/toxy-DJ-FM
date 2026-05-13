import { readFile } from "node:fs/promises";
import path from "node:path";

import { readGeneratedTasteMarkdown } from "@/lib/taste-store";
import type { GenrePreference, MoodMapping, TasteProfile } from "@/lib/types";

const TASTE_FILE = path.join(process.cwd(), "taste.md");

function getSection(markdown: string, heading: string) {
  const pattern = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
  const match = markdown.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function getField(section: string, label: string) {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, "im");
  return section.match(pattern)?.[1]?.trim() ?? "";
}

function parseBulletLines(section: string) {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function parseGenres(section: string): GenrePreference[] {
  return parseBulletLines(section).map((entry) => {
    const [name, weight] = entry.split("|").map((item) => item.trim());
    return {
      name,
      weight: Number(weight ?? "0.7")
    };
  });
}

function parseCsvField(section: string, label: string) {
  const field = getField(section, label);
  return field
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMoodMappings(section: string): MoodMapping[] {
  return parseBulletLines(section).map((entry) => {
    const [mood, paletteRaw] = entry.split("=>").map((item) => item.trim());
    return {
      mood,
      palette: paletteRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    };
  });
}

export function parseTasteProfile(markdown: string): TasteProfile {
  const profileSection = getSection(markdown, "Profile");
  const genreSection = getSection(markdown, "Genres");
  const infoSection = getSection(markdown, "Artists / Eras / Scenes");
  const moodSection = getSection(markdown, "Mood Mapping");
  const hardNoSection = getSection(markdown, "Hard No");
  const radioRulesSection = getSection(markdown, "Radio Rules");
  const signatureSection = getSection(markdown, "Signature Playlists");

  return {
    tagline: getField(profileSection, "Tagline"),
    intro: getField(profileSection, "Intro"),
    djVoice: getField(profileSection, "DJ Voice"),
    genres: parseGenres(genreSection),
    artists: parseCsvField(infoSection, "Artists"),
    eras: parseCsvField(infoSection, "Eras"),
    scenes: parseCsvField(infoSection, "Scenes"),
    moodMappings: parseMoodMappings(moodSection),
    hardNo: parseBulletLines(hardNoSection),
    radioRules: parseBulletLines(radioRulesSection),
    signaturePlaylists: parseBulletLines(signatureSection),
    rawMarkdown: markdown
  };
}

async function readTasteMarkdown() {
  const generated = await readGeneratedTasteMarkdown();
  if (generated) {
    return generated;
  }

  return readFile(TASTE_FILE, "utf8");
}

export async function readTasteProfile() {
  const markdown = await readTasteMarkdown();
  return parseTasteProfile(markdown);
}

export function formatTastePrompt(profile: TasteProfile) {
  return [
    `Tagline: ${profile.tagline}`,
    `Intro: ${profile.intro}`,
    `DJ Voice: ${profile.djVoice}`,
    `Genres: ${profile.genres.map((genre) => `${genre.name}(${genre.weight})`).join(", ")}`,
    `Artists: ${profile.artists.join(", ")}`,
    `Eras: ${profile.eras.join(", ")}`,
    `Scenes: ${profile.scenes.join(", ")}`,
    `Mood Mapping: ${profile.moodMappings.map((item) => `${item.mood}: ${item.palette.join(", ")}`).join(" | ")}`,
    `Hard No: ${profile.hardNo.join(", ")}`,
    `Radio Rules: ${profile.radioRules.join(" / ")}`
  ].join("\n");
}
