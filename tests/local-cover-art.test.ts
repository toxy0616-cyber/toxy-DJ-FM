import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { findCachedCover, syncLocalLibraryCovers } from "@/lib/local-cover-art";
import type { PlayableLibrarySnapshot } from "@/lib/types";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("syncLocalLibraryCovers", () => {
  test("imports sibling covers into the local cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "toxy-cover-"));
    tempRoots.push(root);
    const trackId = `reflection-eternal-${Date.now()}`;
    const filePath = path.join(root, "Nujabes - Reflection Eternal.mp3");
    const coverPath = path.join(root, "cover.png");
    await writeFile(filePath, "audio");
    await writeFile(coverPath, "png");

    const library: PlayableLibrarySnapshot = {
      provider: "local",
      importedAt: new Date().toISOString(),
      rootPath: root,
      tracks: [
        {
          provider: "local",
          providerTrackId: trackId,
          localFilePath: filePath,
          title: "Reflection Eternal",
          artist: "Nujabes",
          album: "Modal Soul",
          energy: "low",
          mood: "rainy",
          tags: [],
          searchableText: "reflection eternal nujabes",
          importedAt: new Date().toISOString(),
          playable: true
        }
      ]
    };

    const summary = await syncLocalLibraryCovers(library, { mode: "local" });
    const cached = await findCachedCover(trackId);

    expect(summary.importedSibling).toBe(1);
    expect(summary.downloadedRemote).toBe(0);
    expect(library.tracks[0]?.coverUrl).toContain("/api/cover/local/");
    expect(cached).toBeTruthy();
  });

  test("downloads remote covers when internet mode is enabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "toxy-cover-"));
    tempRoots.push(root);
    const trackId = `someone-like-you-${Date.now()}`;
    const filePath = path.join(root, "Adele - Someone Like You.mp3");
    await writeFile(filePath, "audio");

    const library: PlayableLibrarySnapshot = {
      provider: "local",
      importedAt: new Date().toISOString(),
      rootPath: root,
      tracks: [
        {
          provider: "local",
          providerTrackId: trackId,
          localFilePath: filePath,
          title: "Someone Like You",
          artist: "Adele",
          album: "21",
          energy: "low",
          mood: "drained",
          tags: [],
          searchableText: "someone like you adele",
          importedAt: new Date().toISOString(),
          playable: true
        }
      ]
    };

    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      if (url.startsWith("https://itunes.apple.com/search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                trackName: "Someone Like You",
                artistName: "Adele",
                collectionName: "21",
                artworkUrl100: "https://example.com/cover100x100bb.jpg"
              }
            ]
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (url.startsWith("https://example.com/cover1200x1200bb.jpg")) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "Content-Type": "image/jpeg" }
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const summary = await syncLocalLibraryCovers(library, { mode: "internet", fetchImpl: fetchMock });
    const cached = await findCachedCover(trackId);

    expect(summary.downloadedRemote).toBe(1);
    expect(summary.missing).toBe(0);
    expect(cached).toBeTruthy();
    expect(library.tracks[0]?.coverUrl).toBe("https://example.com/cover1200x1200bb.jpg");
    expect(await readFile(cached!, "utf8").catch(() => "")).not.toBe("");
  });
});
