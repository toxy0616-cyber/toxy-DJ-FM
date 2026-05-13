import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { buildLocalMusicImport } from "@/lib/local-music";

const tempRoots: Array<{ root: string; files: string[]; dirs: string[] }> = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async ({ root, files, dirs }) => {
      for (const filePath of files) {
        await unlink(filePath).catch(() => {});
      }

      for (const dirPath of dirs) {
        await rmdir(dirPath).catch(() => {});
      }

      await rmdir(root).catch(() => {});
    })
  );
});

describe("buildLocalMusicImport", () => {
  test("scans streamable and encrypted local tracks into a library snapshot", async () => {
    const root = path.join(os.tmpdir(), `toxy-local-${Date.now()}`);
    const focusDir = path.join(root, "Focus");
    const fileA = path.join(focusDir, "Nujabes - Reflection Eternal.mp3");
    const fileB = path.join(focusDir, "Sunset Rollercoaster - My Jinji.wav");
    const fileC = path.join(focusDir, "A-Ha - Take on Me.mgg");
    tempRoots.push({ root, files: [fileA, fileB, fileC], dirs: [focusDir] });
    await mkdir(focusDir, { recursive: true });
    await writeFile(fileA, "sample");
    await writeFile(fileB, "sample");
    await writeFile(fileC, "sample");

    const result = await buildLocalMusicImport(root);
    const importedMgg = result.library.tracks.find((track) => track.localFilePath === fileC);

    expect(result.payload.platform).toBe("local");
    expect(result.payload.listeningHistory).toHaveLength(3);
    expect(result.library.provider).toBe("local");
    expect(result.library.rootPath).toBe(root);
    expect(result.library.tracks[0]?.localFilePath).toContain(root);
    expect(result.library.tracks.some((track) => track.providerTrackId.length > 0)).toBe(true);
    expect(new Set(result.library.tracks.map((track) => track.providerTrackId)).size).toBe(3);
    expect(importedMgg?.playable).toBe(false);
  });
});
