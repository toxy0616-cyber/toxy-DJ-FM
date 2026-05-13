import { normalizeQqMusicPayload } from "@/lib/import-payload";
import type { ListeningRecord, TasteImportPayload } from "@/lib/types";

type JsonObject = Record<string, unknown>;

interface FetchQqMusicImportInput {
  baseUrl: string;
  qqNumber: string;
  cookie?: string;
}

const COLLECTED_PAGE_SIZE = 200;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function isPositivePlaylistId(value: string) {
  if (/^\d+$/.test(value)) {
    return Number(value) > 0;
  }

  return value !== "0";
}

function safeUrl(baseUrl: string, path: string, searchParams: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function resolveDisplayName(detail: unknown) {
  if (!isObject(detail)) {
    return undefined;
  }

  const data = isObject(detail.data) ? detail.data : undefined;
  const user = data && isObject(data.user) ? data.user : undefined;
  const creator = data && isObject(data.creator) ? data.creator : undefined;

  return (
    asString(data?.nickname) ??
    asString(data?.nick) ??
    asString(data?.hostname) ??
    asString(user?.nickname) ??
    asString(user?.nick) ??
    asString(creator?.hostname) ??
    asString(creator?.nickname)
  );
}

function getPlaylistBuckets(summary: unknown): unknown[] {
  if (!isObject(summary)) {
    return [];
  }

  const data = isObject(summary.data) ? summary.data : summary;
  return [
    data.mymusic,
    data.mydiss,
    data.list,
    data.songlist,
    data.items,
    data.collect,
    data.playlists,
    data.disslist,
    data.cdlist
  ];
}

function findPlaylistIdsFromSummary(summary: unknown) {
  const ids = new Set<string>();

  for (const bucket of getPlaylistBuckets(summary)) {
    for (const item of asArray(bucket)) {
      if (!isObject(item)) {
        continue;
      }

      const id =
        asString(item.id) ??
        asString(item.tid) ??
        asString(item.dissid) ??
        asString(item.dirid) ??
        asString(item.listid);
      if (id && isPositivePlaylistId(id)) {
        ids.add(id);
      }
    }
  }

  return ids;
}

function countSummaryItems(summary: unknown) {
  return getPlaylistBuckets(summary).reduce<number>((max, bucket) => Math.max(max, asArray(bucket).length), 0);
}

function normalizeTrackList(raw: unknown, sourceName: string, liked?: boolean, sourcePlaylistId?: string) {
  const normalized = normalizeQqMusicPayload({
    platform: "qqmusic",
    sourceName,
    data: raw
  });

  return normalized.listeningHistory.map((record) => ({
    ...record,
    liked: liked === true ? true : record.liked,
    sourcePlaylistId: record.sourcePlaylistId ?? sourcePlaylistId
  }));
}

async function fetchJson(baseUrl: string, path: string, searchParams: Record<string, string>, cookie?: string) {
  const response = await fetch(safeUrl(baseUrl, path, searchParams), {
    headers: cookie ? { cookie } : undefined
  });

  if (!response.ok) {
    throw new Error(`QQMusicApi request failed: ${path} (${response.status})`);
  }

  return (await response.json()) as unknown;
}

function qqHeaders(referer: string, cookie?: string) {
  return {
    Referer: referer,
    Origin: "https://y.qq.com",
    Cookie: cookie ?? "",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
  };
}

async function fetchQqWebJson(url: string, searchParams: Record<string, string | number>, referer: string, cookie?: string) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(searchParams)) {
    target.searchParams.set(key, String(value));
  }

  const response = await fetch(target, {
    headers: qqHeaders(referer, cookie)
  });

  if (!response.ok) {
    throw new Error(`QQ Music web request failed: ${target.pathname} (${response.status})`);
  }

  const text = (await response.text()).trim();

  if (text.startsWith("{") || text.startsWith("[")) {
    return JSON.parse(text) as unknown;
  }

  const firstParen = text.indexOf("(");
  const lastParen = text.lastIndexOf(")");
  if (firstParen > 0 && lastParen > firstParen) {
    return JSON.parse(text.slice(firstParen + 1, lastParen)) as unknown;
  }

  throw new Error("QQ Music web response was not valid JSON");
}

async function fetchCollectedSonglistsFromWeb(qqNumber: string, cookie?: string) {
  const pages: unknown[] = [];

  for (let sin = 0; ; sin += COLLECTED_PAGE_SIZE) {
    const page = await fetchQqWebJson(
      "https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg",
      {
        ct: 20,
        cid: 205360956,
        userid: qqNumber,
        reqtype: 3,
        sin,
        ein: sin + COLLECTED_PAGE_SIZE
      },
      "https://y.qq.com/portal/profile.html",
      cookie
    );

    pages.push(page);

    if (countSummaryItems(page) < COLLECTED_PAGE_SIZE) {
      break;
    }
  }

  if (pages.length === 1) {
    return pages[0];
  }

  return {
    data: {
      list: pages.flatMap((page) => [...findPlaylistIdsFromSummary(page)].map((id) => ({ id })))
    }
  };
}

export async function buildQqMusicImportPayload(input: FetchQqMusicImportInput): Promise<TasteImportPayload> {
  const detail = await fetchJson(input.baseUrl, "/user/detail", { id: input.qqNumber }, input.cookie);
  const createdSonglists = await fetchJson(input.baseUrl, "/user/songlist", { id: input.qqNumber }, input.cookie);
  const collectedSonglists = await fetchJson(input.baseUrl, "/user/collect/songlist", { id: input.qqNumber }, input.cookie);

  const displayName = resolveDisplayName(detail);
  const sourceName = "qqmusic-api";
  const playlistIds = new Set<string>();

  for (const id of findPlaylistIdsFromSummary(detail)) {
    playlistIds.add(id);
  }

  for (const id of findPlaylistIdsFromSummary(createdSonglists)) {
    playlistIds.add(id);
  }

  for (const id of findPlaylistIdsFromSummary(collectedSonglists)) {
    playlistIds.add(id);
  }

  const detailData = isObject(detail) && isObject(detail.data) ? detail.data : undefined;
  const likedPlaylistId = asString((detailData && asArray(detailData.mymusic)[0])?.id);

  const listeningHistory: ListeningRecord[] = [];

  for (const playlistId of playlistIds) {
    const playlist = await fetchJson(input.baseUrl, "/songlist", { id: playlistId }, input.cookie);
    const trackHistory = normalizeTrackList(playlist, sourceName, playlistId === likedPlaylistId, playlistId);
    listeningHistory.push(...trackHistory);
  }

  return {
    platform: "qqmusic",
    displayName,
    sourceName,
    listeningHistory,
    dislikes: []
  };
}

export async function buildQqMusicImportPayloadFromWeb(input: Omit<FetchQqMusicImportInput, "baseUrl">): Promise<TasteImportPayload> {
  const createdSonglists = await fetchQqWebJson(
    "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss",
    {
      hostUin: 0,
      hostuin: input.qqNumber,
      sin: 0,
      size: 200,
      g_tk: 5381,
      loginUin: 0,
      format: "json",
      inCharset: "utf8",
      outCharset: "utf-8",
      notice: 0,
      platform: "yqq.json",
      needNewCode: 0
    },
    "https://y.qq.com/portal/profile.html",
    input.cookie
  );
  const detail = await fetchQqWebJson(
    "https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg",
    {
      cid: 205360838,
      userid: input.qqNumber,
      reqfrom: 1
    },
    "https://y.qq.com/portal/profile.html",
    input.cookie
  ).catch(() => null);
  const collectedSonglists = await fetchCollectedSonglistsFromWeb(input.qqNumber, input.cookie).catch(() => null);

  const displayName =
    resolveDisplayName(detail) ?? resolveDisplayName(createdSonglists) ?? resolveDisplayName(collectedSonglists);
  const sourceName = "qqmusic-web";
  const playlistIds = new Set<string>();

  for (const id of findPlaylistIdsFromSummary(detail)) {
    playlistIds.add(id);
  }

  for (const id of findPlaylistIdsFromSummary(createdSonglists)) {
    playlistIds.add(id);
  }

  for (const id of findPlaylistIdsFromSummary(collectedSonglists)) {
    playlistIds.add(id);
  }

  const detailData = isObject(detail) && isObject(detail.data) ? detail.data : undefined;
  const likedPlaylistId = asString((detailData && asArray(detailData.mymusic)[0])?.id);

  const listeningHistory: ListeningRecord[] = [];

  for (const playlistId of playlistIds) {
    const playlist = await fetchQqWebJson(
      "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg",
      {
        type: 1,
        utf8: 1,
        disstid: playlistId,
        loginUin: 0
      },
      "https://y.qq.com/n/yqq/playlist",
      input.cookie
    );
    const trackHistory = normalizeTrackList(playlist, sourceName, playlistId === likedPlaylistId, playlistId);
    listeningHistory.push(...trackHistory);
  }

  return {
    platform: "qqmusic",
    displayName,
    sourceName,
    listeningHistory,
    dislikes: []
  };
}
