import type {
  PlayableLibrarySnapshot,
  TasteProfile,
  TrackCandidate,
  TrackIntent,
  WhySelectedEntry
} from "@/lib/types";
import { embedDescription, generateMusicDescription } from "@/lib/music-embedding";
import { getVectorStore } from "@/lib/vector-store";
import { toTrackCandidate } from "@/lib/music-library";
import { resolveDeepSeekConfigFromEnv } from "@/lib/providers/llm";

export interface TrackSelectionResult {
  selectedTracks: TrackCandidate[];
  explanations: WhySelectedEntry[];
  candidateTracks: TrackCandidate[];
}

const LEGACY_MOOD_MAP: Record<string, string> = {
  rainy: "sad",
  drained: "sad",
  "locked-in": "focused",
  romantic: "happy",
  defiant: "energetic"
};

export function normalizeRecommendationMood(rawMood?: string) {
  const normalized = String(rawMood || "").trim().toLowerCase();
  if (!normalized) {
    return "calm";
  }

  if (["happy", "sad", "calm", "focused", "energetic"].includes(normalized)) {
    return normalized;
  }

  return LEGACY_MOOD_MAP[normalized] ?? "calm";
}

export function extractQueryKeywords(query: string) {
  const lower = query.toLowerCase();
  const extracted: string[] = [];
  const keywordGroups: Array<{ token: string; pattern: RegExp }> = [
    { token: "study", pattern: /(study|focus|work|coding|写代码|学习|专注|办公)/ },
    { token: "night", pattern: /(night|late|midnight|夜晚|深夜|凌晨)/ },
    { token: "driving", pattern: /(drive|driving|road|commute|开车|通勤|路上)/ },
    { token: "rain", pattern: /(rain|storm|cloud|下雨|雨天)/ },
    { token: "sleep", pattern: /(sleep|bed|insomnia|睡|助眠|失眠)/ },
    { token: "healing", pattern: /(heal|comfort|warm|治愈|安慰|温暖)/ },
    { token: "ambient", pattern: /(ambient|atmospheric|氛围|空灵)/ },
    { token: "electronic", pattern: /(electronic|edm|synth|电子|合成器)/ },
    { token: "rock", pattern: /(rock|punk|metal|摇滚|朋克)/ },
    { token: "jazz", pattern: /(jazz|blues|爵士|蓝调)/ },
    { token: "classical", pattern: /(classical|piano|violin|古典|钢琴|小提琴)/ },
    { token: "lofi", pattern: /(lofi|lo-fi|indie|独立)/ },
    { token: "mandarin", pattern: /(chinese|mandarin|国语|中文|华语)/ },
    { token: "english", pattern: /(english|欧美|英文)/ },
    { token: "nostalgic", pattern: /(nostalgic|retro|old school|怀旧|复古)/ },
    { token: "upbeat", pattern: /(party|dance|hype|欢乐|派对|蹦迪)/ }
  ];

  for (const group of keywordGroups) {
    if (group.pattern.test(lower)) {
      extracted.push(group.token);
    }
  }

  const lexical = lower
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 12);

  return Array.from(new Set([...extracted, ...lexical])).slice(0, 16);
}

/**
 * RAG Music Provider
 * Recommends tracks by:
 * 1. Converting user intent to vector
 * 2. Searching vector store for similar tracks
 * 3. Filtering with user preferences
 * 4. Using LLM to select final tracks from candidates
 */
export class RAGMusicProvider {
  private readonly deepSeekConfig = resolveDeepSeekConfigFromEnv();

  constructor(private library: PlayableLibrarySnapshot) {}

  private normalizeMood(rawMood?: string) {
    return normalizeRecommendationMood(rawMood);
  }

  private normalizeKeywords(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
          .filter(Boolean)
          .slice(0, 16)
      )
    );
  }

  private extractKeywordsFromQuery(query: string) {
    return extractQueryKeywords(query);
  }

  private async fetchDeepSeek(input: RequestInit & { body: string }) {
    const baseUrl = this.deepSeekConfig.baseUrl?.replace(/\/$/, "");
    const apiKey = this.deepSeekConfig.apiKey?.trim();
    if (!baseUrl || !apiKey) {
      throw new Error("DeepSeek config is missing for RAG provider");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        ...input,
        headers: {
          ...input.headers,
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Generate track intent from user query using LLM
   * Understands natural language emotional and contextual cues
   */
  private async generateTrackIntent(query: string): Promise<TrackIntent> {
    try {
      // Use LLM to understand user's natural language request
      const prompt = `You are a music recommendation assistant. Analyze the user's request and extract their musical preferences.

User Request: "${query}"

Return a JSON object with these exact fields (in Chinese context):
{
  "mood": "one of: happy, sad, calm, focused, energetic",
  "energy": "one of: low, medium, high",
  "palette": ["array of music styles or genres, e.g., 'ambient', 'jazz', 'lofi'"],
  "keywords": ["important context keywords from the request"]
}

Example for "我想听有点忧郁的夜晚开车的歌":
{
  "mood": "sad",
  "energy": "low",
  "palette": ["ambient", "night-drive", "atmospheric"],
  "keywords": ["melancholic", "evening", "driving"]
}

Return ONLY the JSON object, no explanation.`;

      const response = await this.fetchDeepSeek({
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.deepSeekConfig.model || "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          response_format: { type: "json_object" }
        })
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        const content = data.choices[0].message.content;
        const parsed = JSON.parse(content) as {
          mood: string;
          energy: "low" | "medium" | "high";
          palette: string[];
          keywords: string[];
        };
        const fallbackKeywords = this.extractKeywordsFromQuery(query);
        const parsedKeywords = this.normalizeKeywords(parsed.keywords);
        const keywords = parsedKeywords.length > 0 ? parsedKeywords : fallbackKeywords;

        return {
          mood: this.normalizeMood(parsed.mood),
          energy: parsed.energy || "medium",
          palette: parsed.palette && parsed.palette.length > 0 ? parsed.palette : ["any"],
          keywords,
          avoid: [],
          rationale: query
        };
      }
    } catch (error) {
      console.warn("LLM intent generation failed, falling back to regex:", error);
    }

    // Fallback: simple regex-based intent generation
    return this.generateTrackIntentFallback(query);
  }

  /**
   * Fallback intent generation using regex (for when LLM is unavailable)
   */
  private generateTrackIntentFallback(query: string): TrackIntent {
    const lower = query.toLowerCase();

    // Expanded keywords for better Chinese/English support
    let mood = "calm";
    if (/(happy|upbeat|cheerful|excited|开心|兴奋|欢快|活力)/.test(lower))
      mood = "happy";
    if (/(sad|melancholy|depressed|down|unhappy|忧郁|悲伤|沮丧|沉闷|难过)/.test(lower))
      mood = "sad";
    if (/(calm|peaceful|relax|chill|quiet|平静|宁静|放松|安静|冥想)/.test(lower))
      mood = "calm";
    if (/(focused|work|study|concentrate|专注|工作|学习|集中)/.test(lower))
      mood = "focused";
    if (/(angry|energetic|aggressive|excited|生气|愤怒|倔强|激烈|充满能量)/.test(lower))
      mood = "energetic";

    let energy: "low" | "medium" | "high" = "medium";
    if (/(slow|chill|relax|calm|缓慢|放松|轻松|平静|冥想)/.test(lower))
      energy = "low";
    if (/(fast|energetic|upbeat|party|快速|充满能量|聚会|舞蹈)/.test(lower))
      energy = "high";

    // Context-aware palette detection
    const palette: string[] = [];
    if (/(ambient|atmospheric|环境音乐|氛围|空灵)/.test(lower))
      palette.push("ambient");
    if (/(electronic|synth|电子|合成)/.test(lower))
      palette.push("electronic");
    if (/(jazz|爵士)/.test(lower))
      palette.push("jazz");
    if (/(classical|piano|古典|钢琴)/.test(lower))
      palette.push("classical");
    if (/(rock|punk|摇滚|朋克)/.test(lower))
      palette.push("rock");
    if (/(lofi|lo-fi|lo|indie)/.test(lower))
      palette.push("lofi");
    if (/(night|drive|evening|车|夜晚|夜间|开车|驾驶)/.test(lower)) {
      // Night driving context
      if (!palette.includes("ambient")) palette.push("ambient");
      if (!palette.includes("lofi")) palette.push("lofi");
    }

    if (palette.length === 0) palette.push("any");

    return {
      mood: this.normalizeMood(mood),
      energy,
      palette,
      keywords: this.extractKeywordsFromQuery(query),
      avoid: [],
      rationale: query
    };
  }

  /**
   * Search for candidate tracks using RAG
   */
  private async searchCandidates(intent: TrackIntent, topK: number = 20): Promise<TrackCandidate[]> {
    // Generate query text from intent
    const queryText = generateMusicDescription({
      provider: "local",
      providerTrackId: "query",
      title: intent.mood,
      artist: "User Query",
      album: "",
      energy: intent.energy,
      mood: intent.mood,
      tags: Array.from(new Set([...intent.palette, ...intent.keywords])).slice(0, 16),
      searchableText: `${intent.mood} ${intent.energy} ${intent.palette.join(" ")} ${intent.keywords.join(" ")}`.trim(),
      importedAt: new Date().toISOString(),
      playable: true
    });

    // Embed the query
    const queryVector = await embedDescription(queryText);

    // Search vector store
    const vectorStore = getVectorStore();
    const searchResults = await vectorStore.search(queryVector, topK);

    // Convert results to track candidates
    const candidates: TrackCandidate[] = [];
    for (const result of searchResults) {
      const track = this.library.tracks.find(
        (t) => `${t.provider}-${t.providerTrackId}` === result.trackId
      );
      if (track) {
        candidates.push(toTrackCandidate(track));
      }
    }

    return candidates;
  }

  /**
   * Filter candidates based on user preferences
   */
  private filterCandidates(
    candidates: TrackCandidate[],
    profile: TasteProfile,
    recentTrackKeys: string[] = []
  ): TrackCandidate[] {
    return candidates.filter((track) => {
      // Check hard no list
      const trackStr = `${track.title} ${track.artist}`.toLowerCase();
      for (const hardNo of profile.hardNo) {
        if (trackStr.includes(hardNo.toLowerCase())) {
          return false;
        }
      }

      // Check if recently played
      const trackKey = `${track.provider}-${track.providerTrackId}`;
      if (recentTrackKeys.includes(trackKey)) {
        return false;
      }

      // Check playability
      if (!track.playable) {
        return false;
      }

      return true;
    });
  }

  /**
   * Select tracks from candidates using LLM
   */
  private async selectTracksWithLLM(
    candidates: TrackCandidate[],
    profile: TasteProfile,
    intent: TrackIntent,
    limit: number = 3
  ): Promise<{ selectedTracks: TrackCandidate[]; explanations: WhySelectedEntry[] }> {
    if (candidates.length === 0) {
      return { selectedTracks: [], explanations: [] };
    }

    // Prepare candidate list for LLM
    const candidatesList = candidates
      .slice(0, 20)
      .map((t, i) => `${i + 1}. ${t.title} - ${t.artist} (${t.mood}, ${t.energy} energy)`)
      .join("\n");

    const genreStr = profile.genres.map((g) => `${g.name} (${g.weight})`).join(", ");
    const profileStr = `
Artists: ${profile.artists.join(", ")}
Genres: ${genreStr}
Moods: ${profile.moodMappings.map((m) => `${m.mood}: ${m.palette.join(", ")}`).join("; ")}
Hard No: ${profile.hardNo.join(", ")}
DJ Voice: ${profile.djVoice}
`;

    const prompt = `You are Toxy, a personal AI radio DJ. Select ${limit} tracks from the following candidates that best match the request.

User Request: "${intent.rationale}"
Target Mood: ${intent.mood}
Target Energy: ${intent.energy}
Preferred Palettes: ${intent.palette.join(", ")}
Expanded Keywords: ${intent.keywords.join(", ") || "none"}

User Profile:
${profileStr}

Candidate Tracks:
${candidatesList}

Select tracks that:
1. Match the requested mood and energy
2. Align with user's taste profile
3. Offer good variety
4. Provide good musical flow

Return a JSON object with this structure (and ONLY this JSON, no markdown):
{
  "selected": [1, 3, 5],
  "reasons": [
    "reason for first selection",
    "reason for second selection",
    "reason for third selection"
  ]
}`;

    try {
      const response = await this.fetchDeepSeek({
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.deepSeekConfig.model || "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const content = data.choices[0].message.content;
      const selection = JSON.parse(content) as {
        selected: number[];
        reasons: string[];
      };

      const selectedTracks = selection.selected
        .map((idx) => candidates[idx - 1])
        .filter(Boolean);
      const explanations: WhySelectedEntry[] = selection.reasons.map((reason, i) => ({
        label: "rag_selected",
        scoreDelta: 1.0,
        detail: reason
      }));

      return { selectedTracks, explanations };
    } catch (error) {
      console.error("LLM selection failed, returning top candidates:", error);
      const selectedTracks = candidates.slice(0, limit);
      const explanations = selectedTracks.map((_, i) => ({
        label: "rag_fallback",
        scoreDelta: 0.5,
        detail: `Top candidate #${i + 1} from vector search`
      }));
      return { selectedTracks, explanations };
    }
  }

  /**
   * Main recommendation method
   */
  async selectTrackWithExplanation(
    query: string,
    profile: TasteProfile,
    recentTrackKeys: string[] = [],
    limit: number = 3
  ): Promise<TrackSelectionResult> {
    // Generate intent from query
    const intent = await this.generateTrackIntent(query);

    // Search for candidates
    const candidateTracks = await this.searchCandidates(intent, 30);

    // Filter candidates
    const filteredCandidates = this.filterCandidates(candidateTracks, profile, recentTrackKeys);

    if (filteredCandidates.length === 0) {
      console.warn("No suitable candidates found after filtering");
      return {
        selectedTracks: candidateTracks.slice(0, limit),
        explanations: [
          {
            label: "rag_no_filter_match",
            scoreDelta: 0,
            detail: "No candidates matched all filters, returning top matches"
          }
        ],
        candidateTracks
      };
    }

    // Use LLM to select final tracks
    const { selectedTracks, explanations } = await this.selectTracksWithLLM(
      filteredCandidates,
      profile,
      intent,
      limit
    );

    return {
      selectedTracks: selectedTracks.length > 0 ? selectedTracks : filteredCandidates.slice(0, limit),
      explanations: explanations.length > 0 ? explanations : [
        {
          label: "rag_default",
          scoreDelta: 1.0,
          detail: "Selected based on vector similarity"
        }
      ],
      candidateTracks: filteredCandidates.slice(0, 10)
    };
  }
}
