import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChatControlIntent,
  ChatTurn,
  PlayableLibrarySnapshot,
  ProviderConfig,
  RadioState,
  TasteProfile,
  TasteSourceSnapshot,
  TrackCandidate,
  TrackIntent,
  TrackSelectionStatus,
  WhySelectedEntry
} from "@/lib/types";
import { formatTastePrompt } from "@/lib/taste";
import { stripUtf8Bom } from "@/lib/utils";

interface LlmGenerationInput {
  profile: TasteProfile;
  radioState: RadioState;
  runtimeContext: {
    dayPart: string;
    dayName: string;
    localTime: string;
    currentMood: string;
    recentMessages: string[];
  };
  userMessage: string;
  resolvedControlIntent?: ChatControlIntent;
  selectionStatus?: TrackSelectionStatus;
  selectedTrack?: TrackCandidate;
  candidateTracks?: TrackCandidate[];
  recommendationContext?: MusicRecommendationContext;
}

export interface MusicRecommendationContext {
  query: string;
  selectedTracks: TrackCandidate[];
  candidateTracks: TrackCandidate[];
  explanations: WhySelectedEntry[];
  limit: number;
}

interface LlmGenerationOutput {
  reply: string;
  reason: string;
  mood: string;
  onAirLine: string;
  trackIntent: TrackIntent;
  controlIntent: ChatControlIntent;
}

export interface LlmProvider {
  generate(input: LlmGenerationInput): Promise<LlmGenerationOutput>;
  embed(text: string): Promise<number[]>;
}

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";
const LLM_FETCH_TIMEOUT_MS = 8000;
const DATA_DIR = path.join(process.cwd(), ".data");
const TASTE_SOURCE_FILE = path.join(DATA_DIR, "taste-source.json");
const PLAYABLE_LIBRARY_FILE = path.join(DATA_DIR, "playable-library.json");
const LOCAL_RAG_TOP_K = 6;
const LOCAL_RAG_MAX_SNIPPET_CHARS = 220;
const LOCAL_RAG_MAX_TOTAL_CHARS = 1200;
const LOCAL_RAG_CHAT_HISTORY_WINDOW = 12;
const LOCAL_RAG_RECENT_PLAYS_WINDOW = 12;
const LOCAL_RAG_TASTE_TRACK_LIMIT = 8;
const LOCAL_RAG_TASTE_ARTIST_LIMIT = 8;
const LOCAL_RAG_TASTE_HINT_LIMIT = 8;

type LocalRagSource = "taste-source" | "chat-history" | "recent-plays";

const LOCAL_RAG_SOURCE_WEIGHT: Record<LocalRagSource, number> = {
  "chat-history": 0.35,
  "recent-plays": 0.25,
  "taste-source": 0.15
};

const LOCAL_RAG_SOURCE_PRIORITY: Record<LocalRagSource, number> = {
  "chat-history": 0,
  "recent-plays": 1,
  "taste-source": 2
};

const LEGACY_MOOD_MAP: Record<string, string> = {
  rainy: "sad",
  drained: "sad",
  "locked-in": "focused",
  romantic: "happy",
  defiant: "energetic"
};

export interface LocalRagSnippet {
  source: LocalRagSource;
  text: string;
  recencyIndex: number;
  metadata?: Record<string, string | number | boolean>;
}

export const localJsonFileIO = {
  readFile(filePath: string) {
    return readFile(filePath, "utf8");
  }
};

interface LocalRagScoredSnippet {
  snippet: LocalRagSnippet;
  score: number;
}

interface LocalRagContextOptions {
  topK?: number;
  maxSnippetChars?: number;
  maxTotalChars?: number;
  tasteSourceSnapshot?: TasteSourceSnapshot | null;
  playableLibrarySnapshot?: PlayableLibrarySnapshot | null;
}

function inferMood(message: string) {
  const lower = message.toLowerCase();

  if (/(happy|joy|cheer|upbeat|开心|高兴|快乐)/.test(lower)) {
    return "happy";
  }

  if (/(sad|down|melancholy|depressed|难过|伤心|低落|疲惫|累)/.test(lower)) {
    return "sad";
  }

  if (/(calm|relax|chill|quiet|平静|放松|安静)/.test(lower)) {
    return "calm";
  }

  if (/(focus|work|code|coding|study|专注|学习|工作)/.test(lower)) {
    return "focused";
  }

  if (/(angry|rage|defiant|hype|energetic|生气|亢奋|热血)/.test(lower)) {
    return "energetic";
  }

  if (/(rain|storm|cloud|下雨|雨天)/.test(lower)) {
    return "sad";
  }

  return "calm";
}

function inferEnergy(message: string): TrackIntent["energy"] {
  const lower = message.toLowerCase();

  if (/(run|gym|move|dance|楂樿兘)/.test(lower)) {
    return "high";
  }

  if (/(focus|steady|coding|study|涓撴敞)/.test(lower)) {
    return "medium";
  }

  return "low";
}

function paletteForMood(profile: TasteProfile, mood: string) {
  const normalizedMood = LEGACY_MOOD_MAP[mood] ?? mood;
  const direct = profile.moodMappings.find((item) => item.mood === normalizedMood)?.palette;
  if (direct && direct.length > 0) {
    return direct;
  }

  const legacyMood = Object.entries(LEGACY_MOOD_MAP).find(([, value]) => value === normalizedMood)?.[0];
  if (!legacyMood) {
    return [];
  }

  return profile.moodMappings.find((item) => item.mood === legacyMood)?.palette ?? [];
}

export function buildLlmTasteContext(profile: TasteProfile) {
  const summary = formatTastePrompt(profile);
  const rawMarkdown = profile.rawMarkdown.trim();

  if (!rawMarkdown) {
    return summary;
  }

  return [summary, "Full taste file:", rawMarkdown].join("\n\n");
}

function tokenizeForRag(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 2)
    )
  );
}

function clipRagText(text: string, maxChars: number) {
  if (maxChars <= 0) {
    return "";
  }

  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  if (maxChars <= 3) {
    return trimmed.slice(0, maxChars);
  }

  return `${trimmed.slice(0, maxChars - 3).trimEnd()}...`;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function parseRecentTrackKey(key: string) {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === key.length - 1) {
    return null;
  }

  return {
    provider: key.slice(0, separatorIndex),
    providerTrackId: key.slice(separatorIndex + 1)
  };
}

async function readJsonFileSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await localJsonFileIO.readFile(filePath);
    return JSON.parse(stripUtf8Bom(raw)) as T;
  } catch {
    return null;
  }
}

function buildTasteSourceSnippets(snapshot: TasteSourceSnapshot | null): LocalRagSnippet[] {
  if (!snapshot) {
    return [];
  }

  const snippets: LocalRagSnippet[] = [];
  const displayName = snapshot.displayName?.trim() || "listener";
  const sourceName = snapshot.sourceName?.trim() || snapshot.platform;
  const summary = `Taste summary: ${displayName} has ${snapshot.recordCount} imported records from ${sourceName}.`;
  snippets.push({
    source: "taste-source",
    text: summary,
    recencyIndex: 0,
    metadata: { kind: "summary" }
  });

  const topTracks = asStringArray(snapshot.topTracks).slice(0, LOCAL_RAG_TASTE_TRACK_LIMIT);
  for (const [index, track] of topTracks.entries()) {
    snippets.push({
      source: "taste-source",
      text: `Taste top track: ${track}`,
      recencyIndex: index + 1,
      metadata: { kind: "top_track", rank: index + 1 }
    });
  }

  const topArtists = asStringArray(snapshot.topArtists).slice(0, LOCAL_RAG_TASTE_ARTIST_LIMIT);
  if (topArtists.length > 0) {
    snippets.push({
      source: "taste-source",
      text: `Taste top artists: ${topArtists.join(" / ")}`,
      recencyIndex: LOCAL_RAG_TASTE_TRACK_LIMIT + 1,
      metadata: { kind: "top_artists" }
    });
  }

  const tags = asStringArray(snapshot.topTags).slice(0, LOCAL_RAG_TASTE_HINT_LIMIT);
  const hints = asStringArray(snapshot.moodHints).slice(0, LOCAL_RAG_TASTE_HINT_LIMIT);
  const hintTokens = [...new Set([...tags, ...hints])];
  if (hintTokens.length > 0) {
    snippets.push({
      source: "taste-source",
      text: `Taste hints: ${hintTokens.join(", ")}`,
      recencyIndex: LOCAL_RAG_TASTE_TRACK_LIMIT + 2,
      metadata: { kind: "hints" }
    });
  }

  return snippets;
}

function buildChatHistorySnippets(chatHistory: ChatTurn[]) {
  const snippets: LocalRagSnippet[] = [];
  const recentTurns = chatHistory.slice(-LOCAL_RAG_CHAT_HISTORY_WINDOW).reverse();

  for (const [index, turn] of recentTurns.entries()) {
    const role = turn.role === "assistant" ? "assistant" : turn.role === "user" ? "user" : "system";
    const text = turn.text?.trim();
    if (!text) {
      continue;
    }

    snippets.push({
      source: "chat-history",
      text: `${role}: ${text}`,
      recencyIndex: index,
      metadata: { role, createdAt: turn.createdAt }
    });
  }

  return snippets;
}

function buildRecentPlaySnippets(recentTrackKeys: string[], playableLibrarySnapshot: PlayableLibrarySnapshot | null) {
  const snippets: LocalRagSnippet[] = [];
  const tracks = Array.isArray(playableLibrarySnapshot?.tracks) ? playableLibrarySnapshot.tracks : [];

  if (tracks.length === 0) {
    return snippets;
  }

  const trackMap = new Map<string, PlayableLibrarySnapshot["tracks"][number]>();
  for (const track of tracks) {
    trackMap.set(`${track.provider}:${track.providerTrackId}`, track);
  }

  const recentKeys = recentTrackKeys.slice(0, LOCAL_RAG_RECENT_PLAYS_WINDOW);

  for (const [index, key] of recentKeys.entries()) {
    const parsedKey = parseRecentTrackKey(key);
    if (!parsedKey) {
      continue;
    }

    const matched = trackMap.get(`${parsedKey.provider}:${parsedKey.providerTrackId}`);
    if (!matched) {
      continue;
    }

    const tags = Array.isArray(matched.tags) && matched.tags.length > 0 ? matched.tags.join(", ") : "none";
    snippets.push({
      source: "recent-plays",
      text: `Recent play: ${matched.title} - ${matched.artist}; mood=${matched.mood}; tags=${tags}`,
      recencyIndex: index,
      metadata: {
        provider: matched.provider,
        providerTrackId: matched.providerTrackId
      }
    });
  }

  return snippets;
}

function scoreRagSnippet(query: string, queryTokens: string[], snippet: LocalRagSnippet) {
  const snippetLower = snippet.text.toLowerCase();
  const snippetTokens = new Set(tokenizeForRag(snippet.text));
  const normalizedQuery = query.trim().toLowerCase();

  let matchCount = 0;
  for (const token of queryTokens) {
    if (snippetTokens.has(token)) {
      matchCount += 1;
    }
  }

  const overlap = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
  const substringBonus = normalizedQuery.length >= 3 && snippetLower.includes(normalizedQuery) ? 0.4 : 0;
  const sourceWeight = LOCAL_RAG_SOURCE_WEIGHT[snippet.source] ?? 0;
  const recencyBoost =
    snippet.source === "chat-history" || snippet.source === "recent-plays"
      ? Math.max(0, 0.24 - snippet.recencyIndex * 0.02)
      : 0;

  return overlap * 1.7 + substringBonus + sourceWeight + recencyBoost;
}

export function rankLocalRagSnippets(query: string, snippets: LocalRagSnippet[], topK = LOCAL_RAG_TOP_K) {
  const queryTokens = tokenizeForRag(query);
  const scored: LocalRagScoredSnippet[] = snippets.map((snippet) => ({
    snippet,
    score: scoreRagSnippet(query, queryTokens, snippet)
  }));

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (left.snippet.recencyIndex !== right.snippet.recencyIndex) {
      return left.snippet.recencyIndex - right.snippet.recencyIndex;
    }

    const leftPriority = LOCAL_RAG_SOURCE_PRIORITY[left.snippet.source] ?? 99;
    const rightPriority = LOCAL_RAG_SOURCE_PRIORITY[right.snippet.source] ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.snippet.text.localeCompare(right.snippet.text);
  });

  return scored.slice(0, Math.max(1, topK)).map((item) => item.snippet);
}

function applyRagSnippetBudgets(snippets: LocalRagSnippet[], maxSnippetChars: number, maxTotalChars: number) {
  const budgeted: LocalRagSnippet[] = [];
  let used = 0;

  for (const snippet of snippets) {
    const clipped = clipRagText(snippet.text, maxSnippetChars);
    if (!clipped) {
      continue;
    }

    let nextText = clipped;
    const remaining = maxTotalChars - used;
    if (remaining <= 0) {
      break;
    }

    if (nextText.length > remaining) {
      nextText = clipRagText(nextText, remaining);
    }

    if (!nextText) {
      break;
    }

    budgeted.push({
      ...snippet,
      text: nextText
    });
    used += nextText.length;
  }

  return budgeted;
}

function formatRetrievedLocalContext(snippets: LocalRagSnippet[]) {
  if (snippets.length === 0) {
    return "none";
  }

  return snippets.map((snippet, index) => `${index + 1}. [${snippet.source}] ${snippet.text}`).join("\n");
}

function formatRecommendationTrackList(input: LlmGenerationInput) {
  const recommendation = input.recommendationContext;
  if (!recommendation) {
    return [];
  }

  return recommendation.selectedTracks.slice(0, Math.max(1, recommendation.limit)).map((track, index) => {
    const explanation = recommendation.explanations[index]?.detail;
    const tags = track.tags.slice(0, 3).join(", ");
    const tagSuffix = tags ? ` [${tags}]` : "";
    const detailSuffix = explanation ? ` - ${explanation}` : "";
    return `${index + 1}. ${track.title} - ${track.artist}${tagSuffix}${detailSuffix}`;
  });
}

export async function buildRetrievedLocalContext(
  input: Pick<LlmGenerationInput, "userMessage" | "radioState">,
  options?: LocalRagContextOptions
) {
  const tasteSourceSnapshot =
    options?.tasteSourceSnapshot === undefined
      ? await readJsonFileSafe<TasteSourceSnapshot>(TASTE_SOURCE_FILE)
      : options.tasteSourceSnapshot;
  const playableLibrarySnapshot =
    options?.playableLibrarySnapshot === undefined
      ? await readJsonFileSafe<PlayableLibrarySnapshot>(PLAYABLE_LIBRARY_FILE)
      : options.playableLibrarySnapshot;

  const candidates: LocalRagSnippet[] = [
    ...buildTasteSourceSnippets(tasteSourceSnapshot),
    ...buildChatHistorySnippets(input.radioState.chatHistory ?? []),
    ...buildRecentPlaySnippets(input.radioState.recentTrackKeys ?? [], playableLibrarySnapshot)
  ];
  const ranked = rankLocalRagSnippets(input.userMessage, candidates, options?.topK ?? LOCAL_RAG_TOP_K);
  const snippets = applyRagSnippetBudgets(
    ranked,
    options?.maxSnippetChars ?? LOCAL_RAG_MAX_SNIPPET_CHARS,
    options?.maxTotalChars ?? LOCAL_RAG_MAX_TOTAL_CHARS
  );

  return {
    snippets,
    promptBlock: formatRetrievedLocalContext(snippets)
  };
}

function fallbackReason(input: LlmGenerationInput, mood: string) {
  if (input.recommendationContext) {
    return "Built a recommendation set from local RAG matches.";
  }

  if (input.selectionStatus === "picked" && input.selectedTrack) {
    return `Resolved the command and switched to ${input.selectedTrack.title} by ${input.selectedTrack.artist}.`;
  }

  if (input.selectionStatus === "candidate_required") {
    return "The request was understood, but it needs confirmation from the closest playable matches.";
  }

  return `This mood fits ${paletteForMood(input.profile, mood).slice(0, 2).join(" + ") || "your current taste profile"}.`;
}

function buildFallbackReply(input: LlmGenerationInput, mood: string) {
  if (input.recommendationContext) {
    const tracks = formatRecommendationTrackList(input);
    if (tracks.length > 0) {
      return [
        "I pulled a few strong local matches for that feeling:",
        ...tracks,
        "If you want, I can narrow it down to one pick or play a specific song you name."
      ].join("\n");
    }

    return "I could not find a strong local match just now. Try giving me a mood, scene, artist, or song title.";
  }

  if (input.selectionStatus === "picked" && input.selectedTrack) {
    return `Switching now. I lined up ${input.selectedTrack.title} by ${input.selectedTrack.artist} and kept the station pulse steady.`;
  }

  if (input.selectionStatus === "candidate_required") {
    const picks = input.candidateTracks?.slice(0, 3).map((track) => `${track.title} - ${track.artist}`) ?? [];
    if (picks.length > 0) {
      return `I found a few close playable matches. Tell me which one you want: ${picks.join(" / ")}.`;
    }

    return "I understood the request, but I could not find a playable match yet. Try the song title with the artist name.";
  }

  const primaryGenre = input.profile.genres[0]?.name ?? "late-night radio";
  return [
    "I have it.",
    `It's ${input.runtimeContext.localTime} now, so I am leaning into a ${mood} pulse.`,
    `I'll stay close to ${primaryGenre} while we talk and keep the station exactly where it is.`
  ].join(" ");
}

function buildFallbackResponse(input: LlmGenerationInput): LlmGenerationOutput {
  const recommendationTrack = input.recommendationContext?.selectedTracks[0];
  const mood = input.selectedTrack?.mood ?? recommendationTrack?.mood ?? inferMood(input.userMessage);
  const energy = input.selectedTrack?.energy ?? recommendationTrack?.energy ?? inferEnergy(input.userMessage);
  const palette = input.selectedTrack?.tags ?? recommendationTrack?.tags ?? paletteForMood(input.profile, mood);
  const reason = fallbackReason(input, mood);
  const reply = buildFallbackReply(input, mood);
  const onAirLine = input.recommendationContext
    ? recommendationTrack
      ? `Recommendation mode stayed on ${input.radioState.nowPlaying.title} while surfacing ${recommendationTrack.title}.`
      : "Recommendation mode stayed on the current song while surfacing local matches."
    : input.selectionStatus === "picked" && input.selectedTrack
      ? `${input.selectedTrack.title} is on air now.`
      : `${input.runtimeContext.dayPart} transmission: ${mood} mood, signal held steady.`;

  return {
    reply,
    reason,
    mood,
    onAirLine,
    trackIntent: {
      mood,
      energy,
      palette,
      keywords: [],
      avoid: input.profile.hardNo,
      rationale: reason
    },
    controlIntent: input.resolvedControlIntent ?? { type: "none" }
  };
}

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function extractTextContent(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("\n")
    .trim();
}

function parseJsonResponse(content: unknown) {
  const text = stripCodeFence(extractTextContent(content));

  if (!text) {
    throw new Error("Empty response content");
  }

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("No JSON object found in response");
    }

    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  }
}

function buildHeaders(config: ProviderConfig) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`
  };
}

function normalizeControlIntent(value: unknown): ChatControlIntent {
  if (!value || typeof value !== "object") {
    return { type: "none" };
  }

  const type = "type" in value && typeof value.type === "string" ? value.type : "none";
  if (type === "next") {
    return { type: "next" };
  }

  if (type === "queue_index" && "queueIndex" in value && typeof value.queueIndex === "number") {
    return { type: "queue_index", queueIndex: value.queueIndex };
  }

  if (type === "track_query" && "query" in value && typeof value.query === "string") {
    return { type: "track_query", query: value.query };
  }

  return { type: "none" };
}

function toGenerationOutput(parsed: Record<string, unknown>, input: LlmGenerationInput): LlmGenerationOutput {
  if (
    typeof parsed.reply !== "string" ||
    typeof parsed.reason !== "string" ||
    typeof parsed.mood !== "string" ||
    typeof parsed.onAirLine !== "string" ||
    !parsed.trackIntent ||
    typeof parsed.trackIntent !== "object"
  ) {
    throw new Error("Incomplete JSON payload");
  }

  return {
    reply: parsed.reply,
    reason: parsed.reason,
    mood: parsed.mood,
    onAirLine: parsed.onAirLine,
    trackIntent: parsed.trackIntent as TrackIntent,
    controlIntent: normalizeControlIntent(parsed.controlIntent ?? input.resolvedControlIntent)
  };
}

export function resolveDeepSeekConfigFromEnv(env = process.env): ProviderConfig {
  return {
    apiKey: env.DEEPSEEK_API_KEY?.trim(),
    baseUrl: env.DEEPSEEK_BASE_URL?.trim() || DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL?.trim() || DEEPSEEK_DEFAULT_MODEL
  };
}

export function hasLiveLlmConfig(env = process.env) {
  const config = resolveDeepSeekConfigFromEnv(env);
  return Boolean(config.apiKey && config.baseUrl && config.model);
}

class DeepSeekLlmProvider implements LlmProvider {
  constructor(private config: ProviderConfig) {}

  private async buildMessages(input: LlmGenerationInput) {
    const localContext = await buildRetrievedLocalContext(input);
    const isRecommendationMode = Boolean(input.recommendationContext);
    const systemPrompt = [
      "You are Toxy, a personal AI radio DJ.",
      "Reply in English only.",
      "Always respond with strict JSON.",
      "Return JSON only, with no markdown code fences.",
      "Keep the tone atmospheric, intimate, and helpful.",
      "Use the taste profile as the primary taste anchor.",
      "Never recommend anything that conflicts with Hard No.",
      "If a command was already resolved, do not reinterpret it. Just explain and guide naturally.",
      "When the resolved control intent is none, do not imply that the current track changed or that playback was switched.",
      isRecommendationMode
        ? "When recommendation mode is active, recommend only from the provided local candidates, keep the reply to exactly 3 to 5 songs in a numbered list with one short reason per song, and do not imply that playback has changed."
        : "",
      "The reply, reason, and onAirLine fields must all be English."
    ]
      .filter(Boolean)
      .join(" ");

    const userPromptParts = [
      "Return JSON with keys: reply, reason, mood, onAirLine, trackIntent, controlIntent.",
      "trackIntent must include mood, energy, palette, keywords, avoid, rationale.",
      "controlIntent should usually echo the resolved command, or use {\"type\":\"none\"}.",
      "If resolvedControlIntent is none, keep the response conversational and do not turn it into an implicit track-change action.",
      "Do not include any explanation outside the JSON object.",
      `Taste profile:\n${buildLlmTasteContext(input.profile)}`,
      `Current radio mood: ${input.radioState.mood}`,
      `Current song: ${input.radioState.nowPlaying.title} - ${input.radioState.nowPlaying.artist}`,
      `Time context: ${input.runtimeContext.dayName} ${input.runtimeContext.localTime} (${input.runtimeContext.dayPart})`,
      `Recent messages: ${input.runtimeContext.recentMessages.join(" | ") || "none"}`,
      `Retrieved local context (top-k):\n${localContext.promptBlock}`,
      `User message: ${input.userMessage}`,
      `Resolved control intent: ${JSON.stringify(input.resolvedControlIntent ?? { type: "none" })}`
    ];

    if (input.recommendationContext) {
      const tracks = formatRecommendationTrackList(input);
      userPromptParts.push(
        "Recommendation mode: true",
        `Recommendation query: ${input.recommendationContext.query}`,
        `Recommended local tracks:\n${tracks.length > 0 ? tracks.join("\n") : "none"}`,
        `Candidate tracks:\n${
          input.recommendationContext.candidateTracks.slice(0, 10).map((track, index) => `${index + 1}. ${track.title} - ${track.artist}`).join("\n") || "none"
        }`,
        `Selection reasons:\n${
          input.recommendationContext.explanations.map((item, index) => `${index + 1}. ${item.detail}`).join("\n") || "none"
        }`,
        "Write a short conversational recommendation that names the strongest matches in a numbered list, gives one brief reason per song, and asks the user to pick one by index or by title-artist to play. Do not mention that playback changed."
      );
    } else {
      userPromptParts.push(
        `Selection status: ${input.selectionStatus ?? "picked"}`,
        `Selected track: ${input.selectedTrack ? `${input.selectedTrack.title} - ${input.selectedTrack.artist}` : "none"}`,
        `Candidate tracks: ${input.candidateTracks?.map((track) => `${track.title} - ${track.artist}`).join(" | ") || "none"}`
      );
    }

    const userPrompt = userPromptParts.join("\n\n");

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];
  }

  private async requestCompletion(input: LlmGenerationInput, includeResponseFormat: boolean) {
    const messages = await this.buildMessages(input);
    const body: Record<string, unknown> = {
      model: this.config.model,
      temperature: 0.7,
      messages
    };

    if (includeResponseFormat) {
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(`${this.config.baseUrl?.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: buildHeaders(this.config),
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`LLM request failed with ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;

    return toGenerationOutput(parseJsonResponse(content) as Record<string, unknown>, input);
  }

  async generate(input: LlmGenerationInput) {
    if (!this.config.baseUrl || !this.config.apiKey || !this.config.model) {
      return buildFallbackResponse(input);
    }

    try {
      return await this.requestCompletion(input, true);
    } catch {
      try {
        return await this.requestCompletion(input, false);
      } catch {
        return buildFallbackResponse(input);
      }
    }
  }

  async embed(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set - required for embeddings");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Embedding request failed with ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const payload = await response.json();
    const embedding = payload?.data?.[0]?.embedding;

    if (!Array.isArray(embedding)) {
      throw new Error("Unexpected embedding response shape");
    }

    return embedding as number[];
  }
}

export function getLlmProvider() {
  return new DeepSeekLlmProvider(resolveDeepSeekConfigFromEnv());
}

export { buildFallbackResponse };
