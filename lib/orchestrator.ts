import { buildRuntimeContext } from "@/lib/context";
import { getLlmProvider, hasLiveLlmConfig } from "@/lib/providers/llm";
import type { MusicRecommendationContext } from "@/lib/providers/llm";
import { RAGMusicProvider } from "@/lib/providers/rag-music";
import { getMusicProvider } from "@/lib/providers/music";
import { ensureRadioState, pushMood, pushTrackKey, saveRadioState } from "@/lib/radio-state";
import { readTasteProfile } from "@/lib/taste";
import { fetchWeatherContext } from "@/lib/weather";
import { parseControlIntent } from "@/lib/control-intent";
import { readPlayableLibrary } from "@/lib/music-library";
import { getVectorStore } from "@/lib/vector-store";
import { initializeMusicVectorStore } from "@/lib/startup";
import type {
  ChatControlIntent,
  RadioCommentaryPayload,
  ChatResponsePayload,
  ChatTurn,
  DailyPlaylistEntry,
  GreetingResponsePayload,
  RadioSelectPayload,
  RadioState,
  TasteProfile,
  TrackCandidate,
  TrackIntent,
  TrackSelectionStatus,
  WhyRejectedEntry,
  WhySelectedEntry
} from "@/lib/types";
import { makeId } from "@/lib/utils";

// Initialize music vector store at module load time (non-blocking)
void initializeMusicVectorStore();

const LEGACY_MOOD_MAP: Record<string, string> = {
  rainy: "sad",
  drained: "sad",
  "locked-in": "focused",
  romantic: "happy",
  defiant: "energetic"
};

function normalizeMoodLabel(rawMood: string) {
  const mood = String(rawMood || "").trim().toLowerCase();
  if (!mood) {
    return "calm";
  }

  if (["happy", "sad", "calm", "focused", "energetic"].includes(mood)) {
    return mood;
  }

  return LEGACY_MOOD_MAP[mood] ?? "calm";
}

function createAssistantTurn(text: string, relatedTrackId?: string): ChatTurn {
  return {
    id: makeId("chat"),
    role: "assistant",
    text,
    createdAt: new Date().toISOString(),
    relatedTrackId
  };
}

function createUserTurn(text: string): ChatTurn {
  return {
    id: makeId("chat"),
    role: "user",
    text,
    createdAt: new Date().toISOString()
  };
}

function trimHistory(history: ChatTurn[]) {
  return history.slice(-14);
}

function controlMessageFromAction(action: ChatControlIntent) {
  return action.type === "queue_index"
    ? `Switch to queue item ${action.queueIndex}.`
    : action.type === "track_query"
      ? `Play ${action.query}.`
      : "Next track.";
}

function greetingLine(profile: TasteProfile, runtimeContext: ReturnType<typeof buildRuntimeContext>, weatherLine: string) {
  const artist = profile.artists[0] ?? "the records you return to without thinking";
  const intro = [
    "I'm Toxy, keeping watch over this AI radio station around the clock.",
    `Right now it's ${runtimeContext.dayName}, ${runtimeContext.localTime}.`,
    weatherLine,
    `If you want, we can begin near the edge of ${artist}. How is the day treating you?`
  ];

  return intro.join(" ");
}

function isWeatherIntent(message: string) {
  return /(?:\u5929\u6c14|\u6c14\u6e29|\u6e29\u5ea6|\u4e0b\u96e8|\u4e0b\u96ea|\u5916\u9762|\u51b7\u4e0d\u51b7|\u70ed\u4e0d\u70ed|weather|temperature|forecast|rain|snow)/i.test(
    message
  );
}

function isLocationIntent(message: string) {
  return /(?:\u4f60\u77e5\u9053\u6211.*\u5728\u54ea|\u6211\u73b0\u5728\u5728\u54ea|\u4f4d\u7f6e|\u5b9a\u4f4d|location|where am i|where i am|where i'm|do you know where i am)/i.test(
    message
  );
}

function isRecommendationIntent(message: string) {
  const normalized = message.trim();
  return /(?:推荐|推歌|推送|点歌|歌单|来点歌|发(?:几)?首|安利|适合|难过|伤心|低落|治愈|playlist|song\s*list|list\s+of\s+songs|recommend(?:\s+me)?|suggest(?:\s+me)?|play\s+some\s+songs?|songs?\s+(?:for|to)|music\s+(?:for|to)|tracks?\s+(?:for|to)|give\s+me\s+(?:some\s+)?songs?|mood|vibe|sad|happy|calm|focused|energetic)/i.test(
    normalized
  );
}

function buildWeatherReply(message: string, weatherSummary: string, source: "geolocation" | "ip" | "fallback", locationLabel?: string) {
  const askingLocation = isLocationIntent(message);
  const askingWeather = isWeatherIntent(message);

  if (askingLocation) {
    if (source === "geolocation") {
      return `I do not know your exact address, but I can read the weather from the location you shared. ${weatherSummary} I have the air of your side of town now.`;
    }

    if (source === "ip" && locationLabel) {
      return `I cannot see your exact spot, but your network points roughly toward ${locationLabel}. ${weatherSummary} If you want, I can keep the music moving with that weather in mind.`;
    }

    return `I cannot tell exactly where you are from here. ${weatherSummary}`;
  }

  if (askingWeather) {
    return `${weatherSummary} It feels like the kind of weather that changes the shape of a room.`;
  }

  return weatherSummary;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function trackKey(track: TrackCandidate) {
  return `${track.provider}:${track.providerTrackId}`;
}

function intentFromMood(state: RadioState): TrackIntent {
  const mood = normalizeMoodLabel(state.mood);
  return {
    mood,
    energy: state.nowPlaying.energy,
    palette: state.nowPlaying.tags,
    keywords: [],
    avoid: [],
    rationale: "Keep the station within the current emotional lane."
  };
}

function intentFromTrack(track: TrackCandidate, profile: TasteProfile): TrackIntent {
  const normalizedMood = normalizeMoodLabel(track.mood);
  const palette =
    track.tags.length > 0
      ? track.tags
      : profile.moodMappings.find((item) => normalizeMoodLabel(item.mood) === normalizedMood)?.palette ?? [];

  return {
    mood: normalizedMood,
    energy: track.energy,
    palette,
    keywords: [],
    avoid: profile.hardNo,
    rationale: `Follow the texture of ${track.title} by ${track.artist}.`
  };
}

function isDirectTrackMatch(query: string, track: TrackCandidate) {
  const needle = normalizeText(query);
  const title = normalizeText(track.title);
  const artist = normalizeText(track.artist);
  const comboA = normalizeText(`${track.artist} ${track.title}`);
  const comboB = normalizeText(`${track.title} ${track.artist}`);

  return needle === title || needle === artist || needle === comboA || needle === comboB || needle.includes(title) || (needle.includes(title) && needle.includes(artist));
}

function cleanupTrackQuery(query: string) {
  return query
    .replace(/^(?:一首|1首)\s*/i, "")
    .replace(/^(?:我想听|想听)\s*/i, "")
    .replace(/^(?:给我放|帮我放|放给我|来点|来首|来一首|整首|切到)\s*/i, "")
    .replace(/^(?:来个|来一曲)\s*/i, "")
    .replace(/\s*(?:的歌|的歌曲|的音乐|的曲子)$/i, "")
    .replace(/\s*(?:song|songs|music|track|tracks)$/i, "")
    .replace(/[。！？?,，]+$/g, "")
    .trim();
}

function extractArtistRequest(query: string) {
  const artistMatch = query.match(/^(?:一首\s*)?(.+?)\s*(?:的歌|的歌曲|的音乐|的曲子)$/i);
  if (artistMatch?.[1]) {
    return artistMatch[1].trim();
  }

  const englishArtistMatch = query.match(/^(.+?)\s*(?:song|songs|music|track|tracks)$/i);
  if (englishArtistMatch?.[1]) {
    return englishArtistMatch[1].trim();
  }

  return null;
}

function resolveTrackFromCurrentState(query: string, currentState: RadioState) {
  const cleanedQuery = cleanupTrackQuery(query);
  if (!cleanedQuery) {
    return null;
  }

  const currentPool = [currentState.nowPlaying, ...currentState.queue];
  const directMatch = currentPool.find((track) => isDirectTrackMatch(cleanedQuery, track));
  if (!directMatch) {
    return null;
  }

  return {
    track: directMatch,
    cleanedQuery
  };
}

async function resolveControlSelection(
  controlIntent: ChatControlIntent,
  currentState: RadioState,
  profile: TasteProfile
): Promise<{
  selectedTrack?: TrackCandidate;
  queue: TrackCandidate[];
  selectionStatus: TrackSelectionStatus;
  candidateTracks?: TrackCandidate[];
  why_selected?: WhySelectedEntry[];
  why_rejected?: WhyRejectedEntry[];
}> {
  const musicProvider = getMusicProvider();

  if (controlIntent.type === "next") {
    const intent = intentFromMood(currentState);
    const decision = await musicProvider.selectTrackWithExplanation(intent, profile, {
      current: currentState.nowPlaying,
      recentTrackKeys: currentState.recentTrackKeys
    });
    return {
      selectedTrack: decision.selectedTrack,
      queue: decision.queue,
      selectionStatus: "picked",
      why_selected: decision.why_selected,
      why_rejected: decision.why_rejected
    };
  }

  if (controlIntent.type === "queue_index") {
    const selectedTrack = currentState.queue[controlIntent.queueIndex - 1];
    if (!selectedTrack) {
      return {
        queue: currentState.queue,
        selectionStatus: "candidate_required",
        candidateTracks: currentState.queue
      };
    }

    const intent = intentFromTrack(selectedTrack, profile);
    const decision = await musicProvider.selectTrackWithExplanation(intent, profile, {
      current: currentState.nowPlaying,
      recentTrackKeys: [trackKey(selectedTrack), ...(currentState.recentTrackKeys ?? [])],
      forcedTrack: selectedTrack
    });
    return {
      selectedTrack: decision.selectedTrack,
      queue: decision.queue,
      selectionStatus: "picked",
      why_selected: decision.why_selected,
      why_rejected: decision.why_rejected
    };
  }

  if (controlIntent.type === "track_query") {
    const artistRequest = extractArtistRequest(controlIntent.query);
    if (artistRequest) {
      const normalizedArtistNeedle = normalizeText(artistRequest);
      const artistSearchResults = await musicProvider.search(normalizedArtistNeedle, 12);
      const artistMatches = artistSearchResults.filter(
        (track) => normalizeText(track.artist).includes(normalizedArtistNeedle)
      );

      const topArtistMatch = artistMatches[0];
      if (topArtistMatch) {
        const intent = intentFromTrack(topArtistMatch, profile);
        const decision = await musicProvider.selectTrackWithExplanation(intent, profile, {
          current: currentState.nowPlaying,
          recentTrackKeys: currentState.recentTrackKeys,
          forcedTrack: topArtistMatch
        });
        return {
          selectedTrack: decision.selectedTrack,
          queue: decision.queue,
          selectionStatus: "picked",
          candidateTracks: artistMatches.slice(0, 5),
          why_selected: decision.why_selected,
          why_rejected: decision.why_rejected
        };
      }

      return {
        queue: currentState.queue,
        selectionStatus: "candidate_required",
        candidateTracks: artistSearchResults.slice(0, 5)
      };
    }

    const stateMatch = resolveTrackFromCurrentState(controlIntent.query, currentState);
    if (stateMatch) {
      const intent = intentFromTrack(stateMatch.track, profile);
      const decision = await musicProvider.selectTrackWithExplanation(intent, profile, {
        current: currentState.nowPlaying,
        recentTrackKeys: currentState.recentTrackKeys,
        forcedTrack: stateMatch.track
      });
      return {
        selectedTrack: decision.selectedTrack,
        queue: decision.queue,
        selectionStatus: "picked",
        candidateTracks: [stateMatch.track, ...currentState.queue.filter((track) => track.id !== stateMatch.track.id)].slice(0, 5),
        why_selected: decision.why_selected,
        why_rejected: decision.why_rejected
      };
    }

    const cleanedQuery = cleanupTrackQuery(controlIntent.query);
    const candidateTracks = await musicProvider.search(cleanedQuery || controlIntent.query, 5);
    const top = candidateTracks[0];

    if (!top) {
      return {
        queue: currentState.queue,
        selectionStatus: "candidate_required",
        candidateTracks: []
      };
    }

    const duplicateTitle = candidateTracks[1] && normalizeText(candidateTracks[1].title) === normalizeText(top.title);
    if (!isDirectTrackMatch(cleanedQuery || controlIntent.query, top) && duplicateTitle) {
      return {
        queue: currentState.queue,
        selectionStatus: "candidate_required",
        candidateTracks
      };
    }

    const intent = intentFromTrack(top, profile);
    const decision = await musicProvider.selectTrackWithExplanation(intent, profile, {
      current: currentState.nowPlaying,
      recentTrackKeys: [trackKey(top), ...(currentState.recentTrackKeys ?? [])],
      forcedTrack: top
    });
    return {
      selectedTrack: decision.selectedTrack,
      queue: decision.queue,
      selectionStatus: "picked",
      candidateTracks,
      why_selected: decision.why_selected,
      why_rejected: decision.why_rejected
    };
  }

  return {
    queue: currentState.queue,
    selectionStatus: currentState.nowPlaying.provider === "demo" ? "fallback_demo" : "picked"
  };
}

function createUpdatedRadioState(
  currentState: RadioState,
  selectedTrack: TrackCandidate,
  queue: TrackCandidate[],
  mood: string,
  onAirLine: string,
  reason: string,
  chatHistory: ChatTurn[]
): RadioState {
  const normalizedMood = normalizeMoodLabel(mood);
  return {
    nowPlaying: selectedTrack,
    queue,
    mood: normalizedMood,
    onAirLine,
    lastReason: reason,
    updatedAt: new Date().toISOString(),
    recentMoods: pushMood(currentState, normalizedMood),
    recentTrackKeys: pushTrackKey(currentState, selectedTrack),
    chatHistory,
    activeSwitchToken: null
  };
}

function createImmediateTrackSwitchState(
  currentState: RadioState,
  selectedTrack: TrackCandidate,
  queue: TrackCandidate[],
  chatHistory = currentState.chatHistory,
  switchToken: string
): RadioState {
  const normalizedMood = normalizeMoodLabel(selectedTrack.mood);
  return {
    ...currentState,
    nowPlaying: selectedTrack,
    queue,
    mood: normalizedMood,
    onAirLine: `${selectedTrack.title} is live now. Toxy is catching up in the booth.`,
    lastReason: `Switched immediately to ${selectedTrack.title} by ${selectedTrack.artist}.`,
    updatedAt: new Date().toISOString(),
    recentMoods: pushMood(currentState, normalizedMood),
    recentTrackKeys: pushTrackKey(currentState, selectedTrack),
    chatHistory,
    activeSwitchToken: switchToken
  };
}

function buildSelectionPrompt(controlIntent: ChatControlIntent, candidateTracks?: TrackCandidate[]) {
  if (candidateTracks && candidateTracks.length > 0) {
    const picks = candidateTracks.slice(0, 3).map((track) => `${track.title} - ${track.artist}`);
    return `I found a few close playable matches. Tell me which one you want: ${picks.join(" / ")}.`;
  }

  if (controlIntent.type === "queue_index") {
    return "I could not match that queue slot. Try one of the tracks already sitting in the shortlist.";
  }

  return "I heard the request, but I could not find a clear playable match yet. Try the song title together with the artist name.";
}

async function executeControlIntent(
  controlIntent: ChatControlIntent,
  message: string,
  currentState: RadioState,
  profile: TasteProfile,
  runtimeContext: ReturnType<typeof buildRuntimeContext>,
  options?: {
    userTurn?: ChatTurn | null;
  }
): Promise<ChatResponsePayload> {
  const llmProvider = getLlmProvider();
  const selection = await resolveControlSelection(controlIntent, currentState, profile);
  const llm = await llmProvider.generate({
    profile,
    radioState: currentState,
    runtimeContext,
    userMessage: message,
    resolvedControlIntent: controlIntent,
    selectionStatus: selection.selectionStatus,
    selectedTrack: selection.selectedTrack,
    candidateTracks: selection.candidateTracks
  });

  const assistantTurn = createAssistantTurn(llm.reply, selection.selectedTrack?.id);
  const nextHistory = options?.userTurn ? [...currentState.chatHistory, options.userTurn, assistantTurn] : [...currentState.chatHistory, assistantTurn];
  const chatHistory = trimHistory(nextHistory);
  const radioState =
    selection.selectionStatus === "picked" && selection.selectedTrack
      ? createUpdatedRadioState(
          currentState,
          selection.selectedTrack,
          selection.queue,
          llm.mood || selection.selectedTrack.mood,
          llm.onAirLine,
          llm.reason,
          chatHistory
        )
      : {
          ...currentState,
          updatedAt: new Date().toISOString(),
          chatHistory
        };

  await saveRadioState(radioState);

  return {
    assistantTurn,
    mood: radioState.mood,
    reason: llm.reason,
    radioState,
    candidates: selection.selectedTrack ? [selection.selectedTrack, ...selection.queue] : currentState.queue,
    controlIntent,
    selectionStatus: selection.selectionStatus,
    candidateTracks: selection.candidateTracks,
    why_selected: selection.why_selected,
    why_rejected: selection.why_rejected
  };
}

export async function getBootstrapData() {
  const profile = await readTasteProfile();
  const radioState = await ensureRadioState(profile);
  const dailyPlaylist = await getDailyPlaylist();

  return {
    profile,
    radioState,
    dailyPlaylist,
    llmConnected: hasLiveLlmConfig()
  };
}

export async function createGreetingAction(options?: {
  reset?: boolean;
  latitude?: number;
  longitude?: number;
}): Promise<GreetingResponsePayload> {
  const profile = await readTasteProfile();
  const currentState = await ensureRadioState(profile);
  const runtimeContext = buildRuntimeContext(currentState);
  const weather = await fetchWeatherContext(options?.latitude, options?.longitude);
  const weatherLine = weather.summary;
  const assistantTurn = createAssistantTurn(greetingLine(profile, runtimeContext, weatherLine), currentState.nowPlaying.id);
  const chatHistory = trimHistory(options?.reset ? [assistantTurn] : [...currentState.chatHistory, assistantTurn]);
  const radioState = {
    ...currentState,
    updatedAt: new Date().toISOString(),
    onAirLine: "Toxy opened a fresh line and checked the weather before the first exchange.",
    chatHistory
  };

  await saveRadioState(radioState);

  return {
    assistantTurn,
    radioState,
    llmConnected: hasLiveLlmConfig(),
    weatherSummary: weather.summary
  };
}

export async function handleChat(
  message: string,
  options?: {
    latitude?: number;
    longitude?: number;
  }
): Promise<ChatResponsePayload> {
  const profile = await readTasteProfile();
  const currentState = await ensureRadioState(profile);
  const runtimeContext = buildRuntimeContext(currentState);
  const controlIntent = parseControlIntent(message);
  const userTurn = createUserTurn(message);

  if (controlIntent.type !== "none") {
    return executeControlIntent(controlIntent, message, currentState, profile, runtimeContext, {
      userTurn
    });
  }

  if (isWeatherIntent(message) || isLocationIntent(message)) {
    const weather = await fetchWeatherContext(options?.latitude, options?.longitude);
    const assistantTurn = createAssistantTurn(
      buildWeatherReply(message, weather.summary, weather.source, weather.locationLabel),
      currentState.nowPlaying.id
    );
    const chatHistory = trimHistory([...currentState.chatHistory, userTurn, assistantTurn]);
    const radioState = {
      ...currentState,
      updatedAt: new Date().toISOString(),
      chatHistory
    };

    await saveRadioState(radioState);

    return {
      assistantTurn,
      mood: radioState.mood,
      reason: "Answered with location-aware weather context.",
      radioState,
      candidates: [radioState.nowPlaying, ...radioState.queue],
      controlIntent: { type: "none" },
      selectionStatus: radioState.nowPlaying.provider === "demo" ? "fallback_demo" : "picked",
      weatherSummary: weather.summary
    };
  }

  const llmProvider = getLlmProvider();
  if (isRecommendationIntent(message)) {
    const fallbackRecommendationTracks = [currentState.nowPlaying, ...currentState.queue]
      .filter((track) => track.playable)
      .slice(0, 5);

    const buildRecommendationReply = async (recommendationContext: MusicRecommendationContext, fallbackReasonDetail: string) => {
      const recommendationLlm = await llmProvider.generate({
        profile,
        radioState: currentState,
        runtimeContext,
        userMessage: message,
        resolvedControlIntent: controlIntent,
        recommendationContext
      });
      const assistantTurn = createAssistantTurn(recommendationLlm.reply, currentState.nowPlaying.id);
      const radioState = {
        ...currentState,
        updatedAt: new Date().toISOString(),
        chatHistory: trimHistory([...currentState.chatHistory, userTurn, assistantTurn])
      };

      await saveRadioState(radioState);

      return {
        assistantTurn,
        mood: radioState.mood,
        reason: recommendationLlm.reason || fallbackReasonDetail,
        radioState,
        candidates: [radioState.nowPlaying, ...radioState.queue],
        controlIntent: { type: "none" } as const,
        selectionStatus: "candidate_required" as const,
        candidateTracks: recommendationContext.selectedTracks.slice(0, 5),
        why_selected: recommendationContext.explanations.slice(0, 5)
      };
    };

    try {
      const vectorStore = getVectorStore();
      await vectorStore.load();

      if ((await vectorStore.count()) > 0) {
        const library = await readPlayableLibrary();
        if (library) {
          const ragProvider = new RAGMusicProvider(library);
          const ragResult = await ragProvider.selectTrackWithExplanation(message, profile, currentState.recentTrackKeys ?? [], 5);

          if (ragResult.selectedTracks.length > 0) {
            const recommendationContext: MusicRecommendationContext = {
              query: message,
              selectedTracks: ragResult.selectedTracks.slice(0, 5),
              candidateTracks: ragResult.candidateTracks.slice(0, 10),
              explanations: ragResult.explanations.slice(0, 5),
              limit: 5
            };

            return buildRecommendationReply(
              recommendationContext,
              "Built a recommendation set from local RAG matches."
            );
          }
        }
      }
    } catch (error) {
      console.warn("Recommendation mode fallback:", error);
    }

    if (fallbackRecommendationTracks.length > 0) {
      const fallbackExplanations: WhySelectedEntry[] = fallbackRecommendationTracks.map((track, index) => ({
        label: "recommendation_fallback",
        scoreDelta: 0.2,
        detail: `Fallback pick #${index + 1}: ${track.title} by ${track.artist}`
      }));
      const fallbackContext: MusicRecommendationContext = {
        query: message,
        selectedTracks: fallbackRecommendationTracks,
        candidateTracks: fallbackRecommendationTracks,
        explanations: fallbackExplanations,
        limit: fallbackRecommendationTracks.length
      };

      return buildRecommendationReply(
        fallbackContext,
        "Recommendation engine fallback used station queue because local RAG was unavailable."
      );
    }
  }

  const llm = await llmProvider.generate({
    profile,
    radioState: currentState,
    runtimeContext,
    userMessage: message,
    resolvedControlIntent: controlIntent
  });
  const assistantTurn = createAssistantTurn(llm.reply, currentState.nowPlaying.id);
  const radioState = {
    ...currentState,
    updatedAt: new Date().toISOString(),
    chatHistory: trimHistory([...currentState.chatHistory, userTurn, assistantTurn])
  };

  await saveRadioState(radioState);

  return {
    assistantTurn,
    mood: radioState.mood,
    reason: llm.reason,
    radioState,
    candidates: [radioState.nowPlaying, ...radioState.queue],
    controlIntent,
    selectionStatus: radioState.nowPlaying.provider === "demo" ? "fallback_demo" : "picked"
  };
}

export async function selectTrackAction(action: ChatControlIntent) {
  const profile = await readTasteProfile();
  const currentState = await ensureRadioState(profile);
  const runtimeContext = buildRuntimeContext(currentState);
  const message = controlMessageFromAction(action);

  return executeControlIntent(action, message, currentState, profile, runtimeContext);
}

export async function selectTrackImmediateAction(
  action: ChatControlIntent,
  options?: {
    message?: string;
    persistUserTurn?: boolean;
  }
): Promise<RadioSelectPayload> {
  const profile = await readTasteProfile();
  const currentState = await ensureRadioState(profile);
  const selection = await resolveControlSelection(action, currentState, profile);
  const userTurn = options?.persistUserTurn && options.message?.trim() ? createUserTurn(options.message.trim()) : null;

  if (selection.selectionStatus !== "picked" || !selection.selectedTrack) {
    const assistantTurn =
      userTurn || action.type === "track_query" || action.type === "queue_index"
        ? createAssistantTurn(buildSelectionPrompt(action, selection.candidateTracks), currentState.nowPlaying.id)
        : undefined;
    const chatHistory = assistantTurn
      ? trimHistory([...currentState.chatHistory, ...(userTurn ? [userTurn] : []), assistantTurn])
      : currentState.chatHistory;
    const radioState = assistantTurn
      ? {
          ...currentState,
          updatedAt: new Date().toISOString(),
          chatHistory
        }
      : currentState;

    if (assistantTurn) {
      await saveRadioState(radioState);
    }

    return {
      radioState,
      controlIntent: action,
      selectionStatus: selection.selectionStatus,
      candidateTracks: selection.candidateTracks,
      assistantTurn,
      switchToken: null,
      why_selected: selection.why_selected,
      why_rejected: selection.why_rejected
    };
  }

  const switchToken = makeId("switch");
  const chatHistory = userTurn ? trimHistory([...currentState.chatHistory, userTurn]) : currentState.chatHistory;
  const radioState = createImmediateTrackSwitchState(currentState, selection.selectedTrack, selection.queue, chatHistory, switchToken);
  await saveRadioState(radioState);

  return {
    radioState,
    controlIntent: action,
    selectionStatus: selection.selectionStatus,
    candidateTracks: selection.candidateTracks,
    switchToken,
    why_selected: selection.why_selected,
    why_rejected: selection.why_rejected
  };
}

export async function createTrackCommentaryAction(
  action: ChatControlIntent,
  options?: {
    expectedTrackId?: string;
    switchToken?: string;
    message?: string;
  }
): Promise<RadioCommentaryPayload> {
  const profile = await readTasteProfile();
  const currentState = await ensureRadioState(profile);
  const expectedTrackId = options?.expectedTrackId;
  const switchToken = options?.switchToken?.trim() || null;

  if ((expectedTrackId && currentState.nowPlaying.id !== expectedTrackId) || (switchToken && currentState.activeSwitchToken !== switchToken)) {
    return {
      radioState: currentState,
      controlIntent: action,
      selectionStatus: currentState.nowPlaying.provider === "demo" ? "fallback_demo" : "picked",
      skipped: true,
      switchToken: currentState.activeSwitchToken
    };
  }

  const runtimeContext = buildRuntimeContext(currentState);
  const llmProvider = getLlmProvider();
  const llm = await llmProvider.generate({
    profile,
    radioState: currentState,
    runtimeContext,
    userMessage: options?.message?.trim() || controlMessageFromAction(action),
    resolvedControlIntent: action,
    selectionStatus: "picked",
    selectedTrack: currentState.nowPlaying,
    candidateTracks: [currentState.nowPlaying, ...currentState.queue]
  });

  const latestState = await ensureRadioState(profile);
  if ((expectedTrackId && latestState.nowPlaying.id !== expectedTrackId) || (switchToken && latestState.activeSwitchToken !== switchToken)) {
    return {
      radioState: latestState,
      controlIntent: action,
      selectionStatus: latestState.nowPlaying.provider === "demo" ? "fallback_demo" : "picked",
      skipped: true,
      switchToken: latestState.activeSwitchToken
    };
  }

  const assistantTurn = createAssistantTurn(llm.reply, latestState.nowPlaying.id);
  const mood = normalizeMoodLabel(llm.mood || latestState.nowPlaying.mood);
  const radioState = {
    ...latestState,
    mood,
    onAirLine: llm.onAirLine,
    lastReason: llm.reason,
    updatedAt: new Date().toISOString(),
    recentMoods: pushMood(latestState, mood),
    chatHistory: trimHistory([...latestState.chatHistory, assistantTurn]),
    activeSwitchToken: latestState.activeSwitchToken
  };

  await saveRadioState(radioState);

  return {
    assistantTurn,
    radioState,
    controlIntent: action,
    selectionStatus: "picked",
    skipped: false,
    switchToken: radioState.activeSwitchToken
  };
}

export async function getDailyPlaylist(): Promise<DailyPlaylistEntry[]> {
  const profile = await readTasteProfile();
  const musicProvider = getMusicProvider();
  const entries = [
    {
      slot: "Morning Reset",
      mood: "sad",
      summary: "Ease into the day with soft edges and breathing room."
    },
    {
      slot: "Focus Window",
      mood: "focused",
      summary: "Keep the pulse steady and clear enough for work."
    },
    {
      slot: "Night Drift",
      mood: "calm",
      summary: "Lean into the dim, reflective side of the station."
    }
  ] as const;

  const playlist: DailyPlaylistEntry[] = [];

  for (const entry of entries) {
    const palette = profile.moodMappings.find((item) => item.mood === entry.mood)?.palette ?? [];
    const track = await musicProvider.pickTrack(
      {
        mood: entry.mood,
        energy: entry.mood === "focused" ? "medium" : "low",
        palette,
        keywords: [],
        avoid: profile.hardNo,
        rationale: entry.summary
      },
      profile
    );

    playlist.push({
      ...entry,
      track
    });
  }

  return playlist;
}

