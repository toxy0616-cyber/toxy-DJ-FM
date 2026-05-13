import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeTasteImportPayload } from "@/lib/import-payload";
import type { TasteImportPayload } from "@/lib/types";

const RAP_FOCUS_SOURCE_FILE = path.join(process.cwd(), ".data", "rap-focus-source.json");
const RAP_FOCUS_EXTRA_WEIGHT = 2;

async function readRapFocusPayload() {
  try {
    const raw = await readFile(RAP_FOCUS_SOURCE_FILE, "utf8");
    return normalizeTasteImportPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function mergeTasteImportPayload(payload: TasteImportPayload): Promise<TasteImportPayload> {
  if (payload.platform !== "qqmusic" || payload.sourceName === "qqmusic-rap-focus") {
    return payload;
  }

  const rapFocusPayload = await readRapFocusPayload();
  if (!rapFocusPayload || rapFocusPayload.listeningHistory.length === 0) {
    return payload;
  }

  return {
    ...payload,
    sourceName: [payload.sourceName, rapFocusPayload.sourceName].filter(Boolean).join(" + "),
    listeningHistory: [...payload.listeningHistory, ...rapFocusPayload.listeningHistory],
    overlays: [
      ...(payload.overlays ?? []),
      {
        name: "rap-focus",
        sourceName: rapFocusPayload.sourceName,
        weight: RAP_FOCUS_EXTRA_WEIGHT,
        listeningHistory: rapFocusPayload.listeningHistory
      }
    ]
  };
}
