import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ListeningRecord, PlayableLibrarySnapshot, PlayableTrackSnapshot, TasteImportPayload } from "@/lib/types";
import { slugify, uniqueStrings } from "@/lib/utils";

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac"]);

function isAudioFile(filePath: string) {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function inferEnergyFromName(name: string): PlayableTrackSnapshot["energy"] {
  const lower = name.toLowerCase();

  if (/(live|remix|club|edm|drum|bass|rock)/.test(lower)) {
    return "high";
  }

  if (/(focus|study|mix|instrumental|lofi|lo-fi)/.test(lower)) {
    return "medium";
  }

  return "low";
}

function inferMoodFromPath(filePath: string) {
  const lower = filePath.toLowerCase();

  if (/(rain|night|ambient|sleep)/.test(lower)) {
    return "rainy";
  }

  if (/(focus|study|work|instrumental|lofi|lo-fi)/.test(lower)) {
    return "locked-in";
  }

  if (/(love|romance|citypop|city-pop)/.test(lower)) {
    return "romantic";
  }

  if (/(rock|punk|metal|rage)/.test(lower)) {
    return "defiant";
  }

  return "drained";
}

function splitNameParts(baseName: string) {
  const cleaned = baseName.replace(/\[[^\]]*]|\([^\)]*\)/g, "").replace(/\s+/g, " ").trim();
  const separators = [" - ", " — ", " – ", "_-_"];

  for (const separator of separators) {
    const parts = cleaned.split(separator).map((item) => item.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        artist: parts[0],
        title: parts.slice(1).join(" - ")
      };
    }
  }

  return {
    artist: "Local Library",
    title: cleaned || baseName
  };
}

async function walkAudioFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkAudioFiles(fullPath));
      continue;
    }

    if (entry.isFile() && isAudioFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function buildTags(filePath: string, rootPath: string) {
  const relative = path.relative(rootPath, filePath);
  const folders = path.dirname(relative).split(path.sep).filter((item) => item && item !== ".");
  return uniqueStrings(folders.map((item) => item.toLowerCase().replace(/\s+/g, "-"))).slice(0, 6);
}

function buildLocalTrackId(relativePath: string, fallbackName: string) {
  const readable = slugify(relativePath) || slugify(fallbackName) || "local-track";
  const digest = createHash("sha1").update(relativePath.toLowerCase()).digest("hex").slice(0, 12);
  return `${readable}-${digest}`;
}

export async function buildLocalMusicImport(rootPath: string) {
  const resolvedRoot = path.resolve(rootPath);
  const rootStats = await stat(resolvedRoot);
  if (!rootStats.isDirectory()) {
    throw new Error("The provided path is not a folder.");
  }

  const audioFiles = await walkAudioFiles(resolvedRoot);
  if (audioFiles.length === 0) {
    throw new Error("No supported audio files were found in that folder.");
  }

  const importedAt = new Date().toISOString();
  const listeningHistory: ListeningRecord[] = [];
  const tracks: PlayableTrackSnapshot[] = [];

  for (const filePath of audioFiles) {
    const parsed = path.parse(filePath);
    const nameParts = splitNameParts(parsed.name);
    const tags = buildTags(filePath, resolvedRoot);
    const relativePath = path.relative(resolvedRoot, filePath);
    const providerTrackId = buildLocalTrackId(relativePath, parsed.base);
    const energy = inferEnergyFromName(parsed.name);
    const mood = inferMoodFromPath(filePath);

    listeningHistory.push({
      title: nameParts.title,
      artist: nameParts.artist,
      album: path.basename(path.dirname(filePath)) || "Local Library",
      platform: "local",
      sourceTrackId: providerTrackId,
      tags
    });

    tracks.push({
      provider: "local",
      providerTrackId,
      localFilePath: filePath,
      mimeType: undefined,
      title: nameParts.title,
      artist: nameParts.artist,
      album: path.basename(path.dirname(filePath)) || "Local Library",
      durationMs: undefined,
      coverUrl: undefined,
      energy,
      mood,
      tags,
      searchableText: `${nameParts.title} ${nameParts.artist} ${relativePath} ${tags.join(" ")}`.toLowerCase(),
      importedAt,
      playable: true
    });
  }

  const payload: TasteImportPayload = {
    platform: "local",
    displayName: path.basename(resolvedRoot),
    sourceName: "local-files",
    listeningHistory
  };

  const library: PlayableLibrarySnapshot = {
    provider: "local",
    importedAt,
    displayName: path.basename(resolvedRoot),
    sourceName: "local-files",
    rootPath: resolvedRoot,
    tracks
  };

  return {
    payload,
    library
  };
}
