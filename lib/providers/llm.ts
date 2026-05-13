import type { ChatControlIntent, ProviderConfig, RadioState, TasteProfile, TrackCandidate, TrackIntent, TrackSelectionStatus } from "@/lib/types";
import { formatTastePrompt } from "@/lib/taste";

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
}

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";

function inferMood(message: string) {
  const lower = message.toLowerCase();

  if (/(drained|burned|tired|没电|疲惫)/.test(lower)) {
    return "drained";
  }

  if (/(rain|storm|cloud|下雨)/.test(lower)) {
    return "rainy";
  }

  if (/(focus|work|code|coding|study|专注)/.test(lower)) {
    return "locked-in";
  }

  if (/(romantic|crush|想你|暧昧)/.test(lower)) {
    return "romantic";
  }

  if (/(angry|rage|defiant|生气)/.test(lower)) {
    return "defiant";
  }

  return "drained";
}

function inferEnergy(message: string): TrackIntent["energy"] {
  const lower = message.toLowerCase();

  if (/(run|gym|move|dance|高能)/.test(lower)) {
    return "high";
  }

  if (/(focus|steady|coding|study|专注)/.test(lower)) {
    return "medium";
  }

  return "low";
}

function paletteForMood(profile: TasteProfile, mood: string) {
  return profile.moodMappings.find((item) => item.mood === mood)?.palette ?? [];
}

export function buildLlmTasteContext(profile: TasteProfile) {
  const summary = formatTastePrompt(profile);
  const rawMarkdown = profile.rawMarkdown.trim();

  if (!rawMarkdown) {
    return summary;
  }

  return [summary, "Full taste file:", rawMarkdown].join("\n\n");
}

function fallbackReason(input: LlmGenerationInput, mood: string) {
  if (input.selectionStatus === "picked" && input.selectedTrack) {
    return `Resolved the command and switched to ${input.selectedTrack.title} by ${input.selectedTrack.artist}.`;
  }

  if (input.selectionStatus === "candidate_required") {
    return "The request was understood, but it needs confirmation from the closest playable matches.";
  }

  return `This mood fits ${paletteForMood(input.profile, mood).slice(0, 2).join(" + ") || "your current taste profile"}.`;
}

function buildFallbackReply(input: LlmGenerationInput, mood: string) {
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
  const mood = input.selectedTrack?.mood ?? inferMood(input.userMessage);
  const energy = input.selectedTrack?.energy ?? inferEnergy(input.userMessage);
  const palette = input.selectedTrack?.tags ?? paletteForMood(input.profile, mood);
  const reason = fallbackReason(input, mood);
  const reply = buildFallbackReply(input, mood);

  return {
    reply,
    reason,
    mood,
    onAirLine:
      input.selectionStatus === "picked" && input.selectedTrack
        ? `${input.selectedTrack.title} is on air now.`
        : `${input.runtimeContext.dayPart} transmission: ${mood} mood, signal held steady.`,
    trackIntent: {
      mood,
      energy,
      palette,
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

  private buildMessages(input: LlmGenerationInput) {
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
      "The reply, reason, and onAirLine fields must all be English."
    ].join(" ");

    const userPrompt = [
      "Return JSON with keys: reply, reason, mood, onAirLine, trackIntent, controlIntent.",
      "trackIntent must include mood, energy, palette, avoid, rationale.",
      "controlIntent should usually echo the resolved command, or use {\"type\":\"none\"}.",
      "If resolvedControlIntent is none, keep the response conversational and do not turn it into an implicit track-change action.",
      "Do not include any explanation outside the JSON object.",
      `Taste profile:\n${buildLlmTasteContext(input.profile)}`,
      `Current radio mood: ${input.radioState.mood}`,
      `Current song: ${input.radioState.nowPlaying.title} - ${input.radioState.nowPlaying.artist}`,
      `Time context: ${input.runtimeContext.dayName} ${input.runtimeContext.localTime} (${input.runtimeContext.dayPart})`,
      `Recent messages: ${input.runtimeContext.recentMessages.join(" | ") || "none"}`,
      `User message: ${input.userMessage}`,
      `Resolved control intent: ${JSON.stringify(input.resolvedControlIntent ?? { type: "none" })}`,
      `Selection status: ${input.selectionStatus ?? "picked"}`,
      `Selected track: ${input.selectedTrack ? `${input.selectedTrack.title} - ${input.selectedTrack.artist}` : "none"}`,
      `Candidate tracks: ${input.candidateTracks?.map((track) => `${track.title} - ${track.artist}`).join(" | ") || "none"}`
    ].join("\n\n");

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];
  }

  private async requestCompletion(input: LlmGenerationInput, includeResponseFormat: boolean) {
    const body: Record<string, unknown> = {
      model: this.config.model,
      temperature: 0.7,
      messages: this.buildMessages(input)
    };

    if (includeResponseFormat) {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch(`${this.config.baseUrl?.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(this.config),
      body: JSON.stringify(body)
    });

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
}

export function getLlmProvider() {
  return new DeepSeekLlmProvider(resolveDeepSeekConfigFromEnv());
}

export { buildFallbackResponse };
