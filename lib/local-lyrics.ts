import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { readPlayableLibrary } from "@/lib/music-library";
import { qrc } from "smart-lyric";

export interface ParsedLyricLine {
  time: number;
  text: string;
}

export interface TrackLyricsPayload {
  lines: ParsedLyricLine[];
  source: "lrc" | "text" | "qrc" | "none";
  title?: string;
}

const QQMUSIC_LYRIC_CACHE_DIR = "D:\\QQMusicCache\\QQMusicLyricNew";

async function canRead(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSiblingLyric(localFilePath: string) {
  const parsed = path.parse(localFilePath);
  const candidates = [
    path.join(parsed.dir, `${parsed.name}.lrc`),
    path.join(parsed.dir, `${parsed.name}.LRC`),
    path.join(parsed.dir, `${parsed.name}.lyrics.txt`),
    path.join(parsed.dir, `${parsed.name}.txt`)
  ];

  for (const candidate of candidates) {
    if (await canRead(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeLyricToken(value: string) {
  return value
    .toLowerCase()
    .replace(/\.(qrc|lrc|txt)$/g, "")
    .replace(/[_（）()【】\[\]\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLrcTimestamp(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) {
    return null;
  }

  const minutes = Number(match[1] ?? "0");
  const seconds = Number(match[2] ?? "0");
  const fractionRaw = match[3] ?? "0";
  const fraction = Number(fractionRaw.padEnd(3, "0").slice(0, 3));

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(fraction)) {
    return null;
  }

  return minutes * 60 + seconds + fraction / 1000;
}

function parseLrcContent(content: string) {
  const lines: ParsedLyricLine[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(/\[([^\]]+)\]/g)];
    if (matches.length === 0) {
      continue;
    }

    const text = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    if (!text) {
      continue;
    }

    for (const match of matches) {
      const time = parseLrcTimestamp(match[1] ?? "");
      if (time === null) {
        continue;
      }

      lines.push({ time, text });
    }
  }

  return lines.sort((left, right) => left.time - right.time);
}

function parsePlainTextContent(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((text, index) => ({
      time: index * 12,
      text
    }));
}

function filterLyricLine(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(lyrics|composed|arranged|produced)\s+by[:：]?/i.test(trimmed)) {
    return false;
  }

  if (/^\/+$/.test(trimmed)) {
    return false;
  }

  return true;
}

function parseQrcFileContent(content: Buffer) {
  try {
    const decrypted = qrc.decrypt(content);
    if (!decrypted) {
      return [];
    }

    const parsed = qrc.parse(decrypted);
    return parsed.content
      .map((line) => ({
        time: Math.max(0, Math.round(line.start / 1000)),
        text: line.content.map((word) => word.content).join("").trim()
      }))
      .filter((line) => filterLyricLine(line.text));
  } catch {
    return [];
  }
}

async function findQqMusicCachedLyric(track: { title: string; artist: string }) {
  if (!(await canRead(QQMUSIC_LYRIC_CACHE_DIR))) {
    return [];
  }

  const files = await readdir(QQMUSIC_LYRIC_CACHE_DIR, { withFileTypes: true });
  const normalizedTitle = normalizeLyricToken(track.title);
  const normalizedArtist = normalizeLyricToken(track.artist);

  const candidates = files
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".qrc"))
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(QQMUSIC_LYRIC_CACHE_DIR, entry.name),
      normalized: normalizeLyricToken(entry.name)
    }))
    .filter((entry) => entry.normalized.includes(normalizedTitle));

  const ranked = candidates
    .map((entry) => {
      let score = 0;
      if (entry.normalized.includes(normalizedArtist)) {
        score += 4;
      }
      if (entry.normalized.includes(`${normalizedArtist} ${normalizedTitle}`)) {
        score += 4;
      }
      if (entry.name.toLowerCase().endsWith("_qm.qrc")) {
        score += 2;
      }
      if (entry.name.toLowerCase().endsWith("_qmts.qrc")) {
        score -= 1;
      }
      return {
        ...entry,
        score
      };
    })
    .sort((left, right) => right.score - left.score);

  return ranked;
}

export async function readTrackLyrics(provider: string, providerTrackId: string): Promise<TrackLyricsPayload> {
  if (provider === "demo") {
    return {
      lines: [],
      source: "none"
    };
  }

  const library = await readPlayableLibrary();
  if (!library) {
    return {
      lines: [],
      source: "none"
    };
  }

  const track = library.tracks.find((item) => item.provider === provider && item.providerTrackId === providerTrackId);
  if (!track) {
    return {
      lines: [],
      source: "none"
    };
  }

  const cachedQqMusicLyrics = await findQqMusicCachedLyric({
    title: track.title,
    artist: track.artist
  });
  if (cachedQqMusicLyrics.length > 0) {
    for (const lyricFile of cachedQqMusicLyrics) {
      const content = await readFile(lyricFile.fullPath);
      const lines = parseQrcFileContent(content);
      if (lines.length > 0) {
        return {
          lines,
          source: "qrc",
          title: track.title
        };
      }
    }
  }

  if (!track.localFilePath) {
    return {
      lines: [],
      source: "none",
      title: track.title
    };
  }

  const lyricPath = await findSiblingLyric(track.localFilePath);
  if (!lyricPath) {
    return {
      lines: [],
      source: "none",
      title: track.title
    };
  }

  const content = await readFile(lyricPath, "utf8");
  const isLrc = path.extname(lyricPath).toLowerCase() === ".lrc";
  const lines = isLrc ? parseLrcContent(content) : parsePlainTextContent(content);

  return {
    lines,
    source: isLrc ? "lrc" : "text",
    title: track.title
  };
}
