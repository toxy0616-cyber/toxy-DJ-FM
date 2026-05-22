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

function looksLikeRecommendationQuery(query: string) {
  return /(?:有点|一点|夜晚|开车|通勤|路上|氛围|心情|情绪|感觉|适合|难过|开心|平静|专注|活力|sad|happy|calm|focused|energetic|driving|night|road|commute|vibe|mood)/i.test(
    query
  );
}

export function parseControlIntent(message: string): ChatControlIntent {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (/(?:下一首|next|skip|切歌|换一首)/i.test(trimmed)) {
    return { type: "next" };
  }

  const queueMatch = trimmed.match(/第\s*([一二三四五1-5])\s*首/);
  if (queueMatch?.[1]) {
    return {
      type: "queue_index",
      queueIndex: chineseNumeralToNumber(queueMatch[1])
    };
  }

  const ordinalMatch = trimmed.match(/([1-5])\s*(?:号|首)/);
  if (ordinalMatch && /(?:切到|播放|放|来首|来一首|切歌)/.test(trimmed)) {
    return {
      type: "queue_index",
      queueIndex: Number(ordinalMatch[1])
    };
  }

  const trackQueryMatch = trimmed.match(/(?:播放|放|切到|来首|来一首)\s*(.+)$/i);
  if (trackQueryMatch?.[1]) {
    return { type: "track_query", query: trackQueryMatch[1].trim() };
  }

  const naturalTrackQueryMatch = trimmed.match(
    /(?:(?:我想听|想听|给我放|帮我放|给我来点|来点|来一首|一首|切到|切歌)\s*(.+))$/i
  );
  if (naturalTrackQueryMatch?.[1]) {
    const query = naturalTrackQueryMatch[1].trim();
    if (looksLikeRecommendationQuery(query)) {
      return { type: "none" };
    }

    return { type: "track_query", query };
  }

  if (/^(play|listen to)\s+.+$/i.test(lower)) {
    return { type: "track_query", query: trimmed.replace(/^(play|listen to)\s+/i, "").trim() };
  }

  return { type: "none" };
}
