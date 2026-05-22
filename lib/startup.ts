import path from "node:path";
import { access } from "node:fs/promises";

import { getVectorStore } from "@/lib/vector-store";

const DATA_DIR = path.join(process.cwd(), ".data");
const VECTORS_FILE = path.join(DATA_DIR, "music-vectors.json");

let indexingInProgress = false;
let indexingPromise: Promise<void> | null = null;

/**
 * Check if vector store exists and is populated
 */
async function vectorStoreExists(): Promise<boolean> {
  try {
    await access(VECTORS_FILE);
    const vectorStore = getVectorStore();
    await vectorStore.load();
    const count = await vectorStore.count();
    return count > 0;
  } catch {
    return false;
  }
}

/**
 * Trigger music indexing via API
 */
async function triggerMusicIndexing(): Promise<void> {
  try {
    const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
    const port = process.env.PORT?.trim() || "3001";
    const baseUrl = configured || `http://127.0.0.1:${port}`;
    const response = await fetch(`${baseUrl}/api/index-music`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Indexing failed: ${error}`);
    }

    const result = await response.json();
    console.log("Music indexing completed:", result);
  } catch (error) {
    console.warn("Failed to trigger music indexing:", error);
  }
}

/**
 * Initialize music vector store at startup
 * Runs asynchronously in the background
 */
export async function initializeMusicVectorStore(): Promise<void> {
  // Avoid multiple concurrent indexing attempts
  if (indexingInProgress) {
    console.log("Music indexing already in progress");
    return indexingPromise || Promise.resolve();
  }

  try {
    const exists = await vectorStoreExists();
    if (exists) {
      console.log("Vector store already initialized");
      return;
    }

    console.log("Vector store not found, triggering indexing...");
    indexingInProgress = true;

    indexingPromise = triggerMusicIndexing()
      .then(() => {
        console.log("Music indexing completed successfully");
      })
      .catch((error) => {
        console.error("Music indexing failed:", error);
      })
      .finally(() => {
        indexingInProgress = false;
        indexingPromise = null;
      });

    // Don't wait for indexing to complete, let it run in background
    void indexingPromise;
  } catch (error) {
    console.error("Error initializing music vector store:", error);
    indexingInProgress = false;
  }
}

/**
 * Wait for music indexing to complete
 * Useful for tests or when indexing is required
 */
export async function waitForMusicIndexing(): Promise<void> {
  if (indexingPromise) {
    await indexingPromise;
  }
}
