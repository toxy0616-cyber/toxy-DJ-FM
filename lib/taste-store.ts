import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GeneratedTasteArtifacts } from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), ".data");
const GENERATED_TASTE_FILE = path.join(DATA_DIR, "taste.generated.md");
const TASTE_FILE = path.join(process.cwd(), "taste.md");
const SNAPSHOT_FILE = path.join(DATA_DIR, "taste-source.json");
const GENERATED_PROFILE_FILE = path.join(DATA_DIR, "taste-profile.json");

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function readGeneratedTasteMarkdown() {
  try {
    return await readFile(GENERATED_TASTE_FILE, "utf8");
  } catch {
    return null;
  }
}

export async function readTasteSourceSnapshot() {
  try {
    const raw = await readFile(SNAPSHOT_FILE, "utf8");
    return JSON.parse(raw) as GeneratedTasteArtifacts["snapshot"];
  } catch {
    return null;
  }
}

export async function saveGeneratedTasteArtifacts(artifacts: GeneratedTasteArtifacts) {
  await ensureDataDir();
  await writeFile(TASTE_FILE, artifacts.markdown, "utf8");
  await writeFile(GENERATED_TASTE_FILE, artifacts.markdown, "utf8");
  await writeFile(GENERATED_PROFILE_FILE, JSON.stringify(artifacts, null, 2), "utf8");
  await writeFile(
    SNAPSHOT_FILE,
    JSON.stringify(
      {
        platform: artifacts.snapshot.platform,
        importedAt: artifacts.snapshot.importedAt,
        recordCount: artifacts.snapshot.recordCount,
        likedCount: artifacts.snapshot.likedCount,
        skippedCount: artifacts.snapshot.skippedCount,
        topTracks: artifacts.snapshot.topTracks,
        topArtists: artifacts.snapshot.topArtists,
        topGenres: artifacts.snapshot.topGenres,
        topTags: artifacts.snapshot.topTags,
        moodHints: artifacts.snapshot.moodHints
      },
      null,
      2
    ),
    "utf8"
  );
}
