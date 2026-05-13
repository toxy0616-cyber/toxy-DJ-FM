import type { ChatControlIntent } from "@/lib/types";

function chineseNumeralToNumber(value: string) {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5
  };

  return map[value] ?? Number(value);
}

export function parseControlIntent(message: string): ChatControlIntent {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (/(?:下一首|下首|next|skip|切歌|换一首)/i.test(trimmed)) {
    return { type: "next" };
  }

  const queueMatch = trimmed.match(/第\s*([一二三四五1-5])\s*首/);
  if (queueMatch) {
    return {
      type: "queue_index",
      queueIndex: chineseNumeralToNumber(queueMatch[1] ?? "0")
    };
  }

  const ordinalMatch = trimmed.match(/([1-5])\s*(?:号|首)/);
  if (ordinalMatch && /(?:切|播|放|来)/.test(trimmed)) {
    return {
      type: "queue_index",
      queueIndex: Number(ordinalMatch[1])
    };
  }

  const trackQueryMatch = trimmed.match(/(?:播放|放|切到|来首|来一首|听)\s*(.+)$/i);
  if (trackQueryMatch?.[1]) {
    return { type: "track_query", query: trackQueryMatch[1].trim() };
  }

  const naturalTrackQueryMatch = trimmed.match(
    /(?:(?:我)?想听|想听听|给我放|帮我放|放给我|来点|来首|来一首|来个|来一曲|整首|切到)\s*(.+)$/i
  );
  if (naturalTrackQueryMatch?.[1]) {
    return { type: "track_query", query: naturalTrackQueryMatch[1].trim() };
  }

  if (/^(play|listen to)\s+.+$/i.test(lower)) {
    return { type: "track_query", query: trimmed.replace(/^(play|listen to)\s+/i, "").trim() };
  }

  return { type: "none" };
}
