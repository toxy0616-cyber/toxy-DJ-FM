import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MusicVector } from "@/lib/music-embedding";
import { cosineSimilarity } from "@/lib/music-embedding";

const DATA_DIR = path.join(process.cwd(), ".data");
const VECTORS_FILE = path.join(DATA_DIR, "music-vectors.json");

export interface VectorSearchResult {
  trackId: string;
  similarity: number;
  metadata: MusicVector["metadata"];
}

/**
 * In-memory vector store with JSON persistence
 * Supports loading from disk, searching, and saving updates
 */
export class VectorStore {
  private vectors: MusicVector[] = [];
  private loaded = false;

  /**
   * Load vector store from disk
   */
  async load(): Promise<void> {
    try {
      const data = await readFile(VECTORS_FILE, "utf-8");
      const parsed = JSON.parse(data);

      if (!Array.isArray(parsed)) {
        throw new Error("Invalid vector store format");
      }

      this.vectors = parsed;
      this.loaded = true;
      console.log(`Loaded ${this.vectors.length} vectors from ${VECTORS_FILE}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        console.warn("Vector store file not found, starting with empty store");
        this.vectors = [];
        this.loaded = true;
      } else {
        throw error;
      }
    }
  }

  /**
   * Ensure store is loaded
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  /**
   * Search for similar vectors
   * Returns top K most similar tracks
   */
  async search(queryVector: number[], topK: number = 20): Promise<VectorSearchResult[]> {
    if (this.vectors.length === 0) {
      return [];
    }

    // Calculate similarity for all vectors
    const results = this.vectors.map((musicVector) => {
      const similarity = cosineSimilarity(queryVector, musicVector.vector);
      return {
        trackId: musicVector.trackId,
        similarity,
        metadata: musicVector.metadata
      };
    });

    // Sort by similarity (descending) and return top K
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Get track by ID
   */
  async getTrack(trackId: string): Promise<MusicVector | null> {
    return this.vectors.find((v) => v.trackId === trackId) || null;
  }

  /**
   * Add or update vectors
   */
  async addVectors(newVectors: MusicVector[]): Promise<void> {
    // Create a map for quick lookup
    const existingMap = new Map(this.vectors.map((v) => [v.trackId, v]));

    // Add or update vectors
    for (const newVector of newVectors) {
      existingMap.set(newVector.trackId, newVector);
    }

    // Convert back to array
    this.vectors = Array.from(existingMap.values());
    this.loaded = true;

    console.log(`Vector store now contains ${this.vectors.length} vectors`);
  }

  /**
   * Save vector store to disk
   */
  async save(): Promise<void> {
    try {
      const data = JSON.stringify(this.vectors, null, 2);
      await writeFile(VECTORS_FILE, data, "utf-8");
      console.log(`Saved ${this.vectors.length} vectors to ${VECTORS_FILE}`);
    } catch (error) {
      console.error("Failed to save vector store:", error);
      throw error;
    }
  }

  /**
   * Clear all vectors
   */
  async clear(): Promise<void> {
    this.vectors = [];
    this.loaded = true;
    console.log("Vector store cleared");
  }

  /**
   * Get total number of vectors
   */
  async count(): Promise<number> {
    return this.vectors.length;
  }

  /**
   * Get all vectors (useful for debugging)
   */
  async all(): Promise<MusicVector[]> {
    return [...this.vectors];
  }
}

// Global singleton instance
let instance: VectorStore | null = null;

/**
 * Get or create the global vector store instance
 */
export function getVectorStore(): VectorStore {
  if (!instance) {
    instance = new VectorStore();
  }
  return instance;
}

/**
 * Reset the global instance (useful for testing)
 */
export function resetVectorStore(): void {
  instance = null;
}
