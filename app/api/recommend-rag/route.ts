import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PlayableLibrarySnapshot } from "@/lib/types";
import { RAGMusicProvider } from "@/lib/providers/rag-music";
import { getVectorStore } from "@/lib/vector-store";
import { readTasteProfile } from "@/lib/taste";
import { readRadioState } from "@/lib/radio-state";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), ".data");
const PLAYABLE_LIBRARY_FILE = path.join(DATA_DIR, "playable-library.json");

interface RecommendRequest {
  query: string;
  limit?: number;
  context?: "next" | "daily";
}

interface RecommendResponse {
  selectedTracks: Array<{
    id: string;
    title: string;
    artist: string;
    album: string;
    mood: string;
    energy: string;
    provider: string;
  }>;
  candidateTracks: Array<{
    id: string;
    title: string;
    artist: string;
    mood: string;
    energy: string;
  }>;
  explanations: Array<{
    label: string;
    scoreDelta: number;
    detail: string;
  }>;
  timestamp: string;
}

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

/**
 * Get recent track keys from radio state
 */
async function getRecentTrackKeys(): Promise<string[]> {
  try {
    const radioState = await readRadioState();
    const keys: string[] = [];

    // Add current track
    if (radioState?.nowPlaying) {
      keys.push(
        `${radioState.nowPlaying.provider}-${radioState.nowPlaying.providerTrackId}`
      );
    }

    // Add recent queue
    if (radioState?.queue) {
      for (const track of radioState.queue) {
        keys.push(`${track.provider}-${track.providerTrackId}`);
      }
    }

    return keys;
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RecommendRequest;
    const { query, limit = 3, context = "next" } = body;

    if (!query || typeof query !== "string") {
      return Response.json(
        { error: "Missing or invalid query parameter" },
        { status: 400 }
      );
    }

    // Check if vector store is populated
    const vectorStore = getVectorStore();
    await vectorStore.load();
    const vectorCount = await vectorStore.count();

    if (vectorCount === 0) {
      return Response.json(
        {
          error: "Vector store not initialized",
          message: "Please call POST /api/index-music first to generate embeddings"
        },
        { status: 503 }
      );
    }

    // Get music library
    const library = await readLocalLibrary();
    if (!library) {
      return Response.json(
        { error: "Local music library not found" },
        { status: 400 }
      );
    }

    // Get user taste profile
    const profile = await readTasteProfile();
    if (!profile) {
      return Response.json(
        { error: "User taste profile not found" },
        { status: 400 }
      );
    }

    // Get recent tracks to avoid repetition
    const recentTrackKeys = await getRecentTrackKeys();

    // Create RAG provider
    const ragProvider = new RAGMusicProvider(library);

    // Get recommendations
    const result = await ragProvider.selectTrackWithExplanation(
      query,
      profile,
      recentTrackKeys,
      limit
    );

    // Format response
    const response: RecommendResponse = {
      selectedTracks: result.selectedTracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        mood: track.mood,
        energy: track.energy,
        provider: track.provider
      })),
      candidateTracks: result.candidateTracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        mood: track.mood,
        energy: track.energy
      })),
      explanations: result.explanations,
      timestamp: new Date().toISOString()
    };

    return Response.json(response);
  } catch (error) {
    console.error("RAG recommendation failed:", error);
    return Response.json(
      {
        error: "Recommendation generation failed",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  // GET endpoint with query parameter
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const limit = parseInt(url.searchParams.get("limit") || "3", 10);

  if (!query) {
    return Response.json(
      { error: "Missing query parameter 'q'" },
      { status: 400 }
    );
  }

  // Delegate to POST handler
  const postRequest = new Request(request.url, {
    method: "POST",
    body: JSON.stringify({ query, limit })
  });

  return POST(postRequest);
}
