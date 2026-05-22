import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PlayableLibrarySnapshot } from "@/lib/types";
import { buildLocalMusicImport, enrichLocalLibraryWithLastfm } from "@/lib/local-music";
import { buildMusicVectorIndex } from "@/lib/music-embedding";
import { getVectorStore, resetVectorStore } from "@/lib/vector-store";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), ".data");
const PLAYABLE_LIBRARY_FILE = path.join(DATA_DIR, "playable-library.json");

/**
 * Read local music library from cache
 */
async function readLocalLibrary(): Promise<PlayableLibrarySnapshot | null> {
  try {
    const data = await readFile(PLAYABLE_LIBRARY_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const startTime = Date.now();

    // Get music library
    const library = await readLocalLibrary();
    if (!library) {
      return Response.json(
        { error: "Local music library not found. Please scan music first." },
        { status: 400 }
      );
    }

    console.log(`Starting music indexing for ${library.tracks.length} tracks...`);

    // Enrich tracks with Last.fm metadata
    console.log("Enriching tracks with Last.fm metadata...");
    const enrichedData = await enrichLocalLibraryWithLastfm(library);

    // Build vector index
    console.log("Building vector embeddings...");
    const vectors = await buildMusicVectorIndex(library.tracks, enrichedData);

    if (vectors.length === 0) {
      return Response.json(
        { error: "Failed to generate any embeddings" },
        { status: 500 }
      );
    }

    // Save to vector store
    console.log("Saving vector store...");
    resetVectorStore();
    const vectorStore = getVectorStore();
    await vectorStore.addVectors(vectors);
    await vectorStore.save();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    return Response.json({
      status: "indexed",
      count: vectors.length,
      duration: `${duration}s`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Music indexing failed:", error);
    return Response.json(
      {
        error: "Music indexing failed",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const vectorStore = getVectorStore();
    await vectorStore.load();
    const count = await vectorStore.count();

    return Response.json({
      status: "ok",
      vectorStoreSize: count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Vector store status check failed:", error);
    return Response.json(
      {
        error: "Failed to check vector store status",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
