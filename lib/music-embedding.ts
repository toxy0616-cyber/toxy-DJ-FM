import type { PlayableTrackSnapshot } from "@/lib/types";
import { getLlmProvider } from "@/lib/providers/llm";

export interface TrackMetadataEnriched {
  genres: string[];
  tags: string[];
  description: string;
  era?: string;
}

export interface MusicVector {
  trackId: string;
  vector: number[];
  metadata: {
    title: string;
    artist: string;
    album: string;
    energy: "low" | "medium" | "high";
    mood: string;
    tags: string[];
    genres?: string[];
    era?: string;
    provider: "local" | "qqmusic";
    providerTrackId: string;
    searchableText?: string;
  };
}

/**
 * Generate a text description for a track to be embedded
 * Combines track metadata into a meaningful string representation
 */
export function generateMusicDescription(
  track: PlayableTrackSnapshot,
  enriched?: TrackMetadataEnriched
): string {
  const parts: string[] = [];

  // Main info
  parts.push(`${track.artist} - ${track.title}`);

  // Album
  if (track.album && track.album !== "Local Library") {
    parts.push(`Album: ${track.album}`);
  }

  // Genres
  if (enriched?.genres && enriched.genres.length > 0) {
    parts.push(`Genres: ${enriched.genres.join(", ")}`);
  }

  // Tags
  const allTags = [...(track.tags || []), ...(enriched?.tags || [])];
  if (allTags.length > 0) {
    parts.push(`Tags: ${allTags.join(", ")}`);
  }

  // Era
  if (enriched?.era) {
    parts.push(`Era: ${enriched.era}`);
  }

  // Description
  if (enriched?.description) {
    parts.push(`Description: ${enriched.description}`);
  }

  // Energy and mood
  parts.push(`Energy: ${track.energy}, Mood: ${track.mood}`);

  return parts.join("\n");
}

/**
 * Embed text description using LLM provider
 * Returns a vector representation of the music
 */
export async function embedDescription(text: string): Promise<number[]> {
  try {
    const llmProvider = getLlmProvider();
    const vector = await llmProvider.embed(text);
    return vector;
  } catch (error) {
    console.error("Failed to embed description:", error);
    throw new Error(`Embedding failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Build complete vector index for all tracks in library
 */
export async function buildMusicVectorIndex(
  tracks: PlayableTrackSnapshot[],
  enrichedData?: Map<string, TrackMetadataEnriched>
): Promise<MusicVector[]> {
  const vectors: MusicVector[] = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const enriched = enrichedData?.get(track.providerTrackId);

    try {
      // Generate description text
      const description = generateMusicDescription(track, enriched);

      // Embed the description
      const vector = await embedDescription(description);

      vectors.push({
        trackId: `${track.provider}-${track.providerTrackId}`,
        vector,
        metadata: {
          title: track.title,
          artist: track.artist,
          album: track.album,
          energy: track.energy,
          mood: track.mood,
          tags: track.tags || [],
          genres: enriched?.genres,
          era: enriched?.era,
          provider: track.provider,
          providerTrackId: track.providerTrackId,
          searchableText: track.searchableText
        }
      });

      // Progress logging
      if ((i + 1) % 50 === 0) {
        console.log(`Embedded ${i + 1}/${tracks.length} tracks`);
      }
    } catch (error) {
      console.error(`Failed to embed track ${track.title} - ${track.artist}:`, error);
      // Continue with next track instead of failing
      continue;
    }
  }

  return vectors;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vector dimensions must match");
  }

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dotProduct / (magA * magB);
}
