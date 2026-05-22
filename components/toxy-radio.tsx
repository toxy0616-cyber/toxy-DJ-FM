"use client";

import Image from "next/image";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { parseControlIntent } from "@/lib/control-intent";

import type {
  ChatControlIntent,
  ChatResponsePayload,
  ChatTurn,
  DailyPlaylistEntry,
  GreetingResponsePayload,
  RadioCommentaryPayload,
  RadioSelectPayload,
  RadioState,
  TasteProfile,
  TrackCandidate,
  WhyRejectedEntry,
  WhySelectedEntry
} from "@/lib/types";

interface ToxyRadioProps {
  profile: TasteProfile;
  radioState: RadioState;
  dailyPlaylist: DailyPlaylistEntry[];
  llmConnected: boolean;
}

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsResponsePayload {
  lines: LyricLine[];
  source: "lrc" | "text" | "none";
  title?: string;
}

type ThemeMode = "dark" | "light";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type Coordinates = {
  latitude: number;
  longitude: number;
};

type SavedProgressMap = Record<string, number>;
type TrackActivationIntent = {
  trackId: string;
  activationToken: number;
  resetProgress: boolean;
  resumePlayback: boolean;
};

type TrackDecisionExplanation = {
  trackId: string;
  why_selected: WhySelectedEntry[];
  why_rejected: WhyRejectedEntry[];
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.44,
      delay: index * 0.06,
      ease: "easeOut"
    }
  })
};

const wavePattern = [0.28, 0.9, 0.44, 0.72, 0.34, 0.95, 0.54, 0.79, 0.31, 0.67, 0.41, 0.84];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  });
}

function formatTrackTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function parseDuration(durationLabel?: string) {
  if (!durationLabel) {
    return 180;
  }

  const [minutes = "0", seconds = "0"] = durationLabel.split(":");
  const duration = Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(duration) && duration > 0 ? duration : 180;
}

function fallbackDuration(track: TrackCandidate) {
  if (track.durationMs && track.durationMs > 0) {
    return Math.max(1, Math.round(track.durationMs / 1000));
  }

  return parseDuration(track.durationLabel);
}

function buildTasteLabels(profile: TasteProfile, dailyPlaylist: DailyPlaylistEntry[]) {
  const labels = [
    ...profile.genres.slice(0, 3).map((item) => item.name),
    ...profile.scenes.slice(0, 2),
    ...profile.eras.slice(0, 1),
    ...dailyPlaylist.slice(0, 2).map((item) => item.mood)
  ];

  return Array.from(new Set(labels))
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => item.toUpperCase());
}

function buildLocalSystemTurn(text: string): ChatTurn {
  return {
    id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "system",
    text,
    createdAt: new Date().toISOString()
  };
}

async function requestJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {}
): Promise<T> {
  const { timeoutMs = 12000, retries = 0, ...requestInit } = init;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const externalSignal = requestInit.signal;
    const onExternalAbort = () => controller.abort();

    if (externalSignal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(input, {
        ...requestInit,
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({} as { error?: string; details?: string }));
        const message = detail.error || detail.details || `${response.status} ${response.statusText || "Request failed"}`;
        throw new Error(message);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      attempt += 1;
    } finally {
      window.clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

function toRadioSelectRequestBody(action: ChatControlIntent, message?: string) {
  const base: Record<string, unknown> = {
    action: action.type
  };

  if (action.type === "queue_index") {
    base.queueIndex = action.queueIndex;
  }

  if (action.type === "track_query") {
    base.query = action.query;
  }

  if (message?.trim()) {
    base.message = message.trim();
  }

  return base;
}

function parseRecommendationChoice(rawMessage: string, maxSize: number) {
  const normalized = rawMessage.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const chineseMatch = normalized.match(/第\s*([一二三四五六七八九1-9])\s*首/);
  const plainMatch = normalized.match(/(?:^|\s)([1-9])(?:\s|$|首|号)/);
  const englishMatch = normalized.match(/\b(?:pick|play|choose)\s*(?:#|no\.?\s*)?([1-9])\b/i);

  const token = chineseMatch?.[1] ?? englishMatch?.[1] ?? plainMatch?.[1];
  if (!token) {
    return null;
  }

  const chineseMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  const parsed = chineseMap[token] ?? Number(token);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > maxSize) {
    return null;
  }

  const seemsSelectionIntent = /(播放|放|切到|选|选择|pick|play|choose|来一首|来首|第)/i.test(normalized);
  if (!seemsSelectionIntent) {
    return null;
  }

  return parsed - 1;
}

function toPlayableTrackQuery(track: Pick<TrackCandidate, "title" | "artist">) {
  return `${track.title} - ${track.artist}`;
}

function trackTitleClassName(title: string) {
  const length = Array.from(title.trim()).length;

  if (length >= 40) {
    return "text-[22px] md:text-[24px]";
  }

  if (length >= 28) {
    return "text-[24px] md:text-[26px]";
  }

  return "text-[28px]";
}

function trackTitleMarqueeDuration(title: string) {
  const length = Array.from(title.trim()).length;
  return `${Math.max(11, Math.round(length * 0.42))}s`;
}

function progressStorageKey(track: Pick<TrackCandidate, "provider" | "providerTrackId">) {
  return `toxy-progress:${track.provider}:${track.providerTrackId}`;
}

function trackArtistMarqueeDuration(artist: string) {
  const length = Array.from(artist.trim()).length;
  return `${Math.max(13, Math.round(length * 0.5))}s`;
}

function isHotkeyBlockedTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    tagName === "button" ||
    tagName === "a" ||
    target.isContentEditable
  );
}

const safePoeticCaptionPool = [
  "The room keeps a little moonlight for whoever is still awake.",
  "Some songs arrive like weather, some like memory.",
  "We leave static at the edges so the heart can echo.",
  "Tonight the signal leans soft, like rain on a train window.",
  "Between one breath and the next, the station learns your silence.",
  "Neon fades, but the chorus keeps walking beside you."
];

function buildTrackCaptionSafe(track: TrackCandidate) {
  const texture = track.tags.slice(0, 2).join(" / ") || track.mood;
  return `${track.title} drifts in with a ${texture.toLowerCase()} glow.`;
}

function buildWeatherCaptionSafe(summary: string) {
  if (!summary.trim()) {
    return null;
  }

  return `${summary} The weather reaches the city before it reaches your headphones.`;
}

function buildRotatingCaptionsSafe(weatherSummary: string, track: TrackCandidate) {
  return [...safePoeticCaptionPool, buildWeatherCaptionSafe(weatherSummary), buildTrackCaptionSafe(track)]
    .filter((item): item is string => Boolean(item && item.trim()))
    .map((item) => item.trim());
}

function splitCompanionLinesSafe(text: string) {
  const normalized = text
    .replace(/([,.;!?。！？])/g, "$1|")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);

  const pieces = normalized.flatMap((item) => {
    if (Array.from(item).length <= 52) {
      return [item];
    }

    return item
      .split(/\s+/)
      .reduce<string[]>((parts, word) => {
        const current = parts.length > 0 ? parts[parts.length - 1] : "";
        if (!current) {
          parts.push(word);
          return parts;
        }

        if (`${current} ${word}`.length > 44) {
          parts.push(word);
        } else {
          parts[parts.length - 1] = `${current} ${word}`;
        }

        return parts;
      }, [])
      .filter(Boolean);
  });

  return pieces.slice(0, 4);
}

function buildCompanionLines(track: TrackCandidate, radioState: RadioState, activeCaption: string) {
  const relatedCommentary = [...radioState.chatHistory]
    .reverse()
    .find((turn) => turn.role === "assistant" && (!turn.relatedTrackId || turn.relatedTrackId === track.id))?.text;

  const rawLines = [
    relatedCommentary,
    radioState.lastReason,
    radioState.onAirLine,
    activeCaption,
    buildTrackCaptionSafe(track)
  ]
    .filter((item): item is string => Boolean(item && item.trim()))
    .flatMap((item) => splitCompanionLinesSafe(item));

  const uniqueLines = Array.from(new Set(rawLines.map((item) => item.trim()).filter(Boolean)));
  return uniqueLines.slice(0, Math.min(4, Math.max(2, uniqueLines.length)));
}

function AudioWave({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div aria-hidden="true" className="flex h-8 items-end gap-1.5">
      {wavePattern.map((value, index) => (
        <span
          className="toxy-wave-bar"
          data-playing={isPlaying}
          key={`${value}-${index}`}
          style={
            {
              "--wave-height": `${Math.round(value * 100)}%`,
              "--wave-delay": `${index * 0.08}s`,
              "--wave-duration": `${0.94 + (index % 4) * 0.14}s`
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function TasteSphere({ labels, theme }: { labels: string[]; theme: ThemeMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const pointCount = 220;
    const pointColor = theme === "light" ? "233,238,245" : "0,255,170";
    const glowColor = theme === "light" ? "16,185,129" : "0,255,170";
    const ringColor = theme === "light" ? "100,116,139" : "0,255,170";
    const points = Array.from({ length: pointCount }, (_, index) => {
      const phi = Math.acos(1 - (2 * (index + 0.5)) / pointCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (index + 0.5);

      return {
        x: Math.cos(theta) * Math.sin(phi),
        y: Math.sin(theta) * Math.sin(phi),
        z: Math.cos(phi)
      };
    });

    let frame = 0;

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = (time: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const radius = Math.min(width, height) * 0.3;
      const centerX = width / 2;
      const centerY = height / 2;
      const rotation = time * 0.00042;
      const tilt = 0.58;
      const cosX = Math.cos(tilt);
      const sinX = Math.sin(tilt);

      context.clearRect(0, 0, width, height);

      const projected = points
        .map((point) => {
          const cosY = Math.cos(rotation);
          const sinY = Math.sin(rotation);
          const x1 = point.x * cosY - point.z * sinY;
          const z1 = point.x * sinY + point.z * cosY;
          const y2 = point.y * cosX - z1 * sinX;
          const z2 = point.y * sinX + z1 * cosX;
          const perspective = 1.48 / (1.82 - z2 * 0.58);

          let screenX = centerX + x1 * radius * perspective;
          let screenY = centerY + y2 * radius * perspective;

          if (pointerRef.current.active) {
            const pointerX = pointerRef.current.x * width;
            const pointerY = pointerRef.current.y * height;
            const dx = screenX - pointerX;
            const dy = screenY - pointerY;
            const distance = Math.hypot(dx, dy) || 1;
            const influence = radius * 0.76;

            if (distance < influence) {
              const force = (1 - distance / influence) * 22;
              screenX += (dx / distance) * force;
              screenY += (dy / distance) * force;
            }
          }

          return {
            x: screenX,
            y: screenY,
            z: z2,
            size: clamp(1.25 + (z2 + 1) * 1.8, 1.2, 4.8),
            alpha: clamp(0.16 + (z2 + 1) * 0.32, 0.1, 0.88)
          };
        })
        .sort((left, right) => left.z - right.z);

      for (const point of projected) {
        context.beginPath();
        context.fillStyle = `rgba(${pointColor},${theme === "light" ? Math.min(1, point.alpha + 0.08) : point.alpha})`;
        context.shadowColor = `rgba(${glowColor},0.7)`;
        context.shadowBlur = point.size * 4;
        context.arc(point.x, point.y, point.size, 0, Math.PI * 2);
        context.fill();
      }

      context.shadowBlur = 0;
      context.strokeStyle = `rgba(${ringColor},0.14)`;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(centerX, centerY, radius * 1.16, 0, Math.PI * 2);
      context.stroke();

      frame = window.requestAnimationFrame(render);
    };

    resize();
    frame = window.requestAnimationFrame(render);

    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [theme]);

  return (
    <div className="mt-4">
      <div
        className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[radial-gradient(circle_at_center,var(--accent-soft),transparent_54%),radial-gradient(var(--module-dot-color)_1px,transparent_1px),linear-gradient(180deg,var(--surface-2),transparent)] bg-[length:auto,14px_14px,auto]"
        onPointerLeave={() => {
          pointerRef.current.active = false;
        }}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          pointerRef.current = {
            x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
            y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
            active: true
          };
        }}
      >
        <canvas className="block h-[220px] w-full" ref={canvasRef} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {labels.map((label) => (
          <span
            className="rounded-full border border-[var(--line)] bg-[var(--surface-3)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--text-soft)]"
            key={label}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TerminalMessage({
  turn,
  canSpeak,
  isSpeaking,
  onSpeak
}: {
  turn: ChatTurn;
  canSpeak: boolean;
  isSpeaking: boolean;
  onSpeak: (turn: ChatTurn) => void;
}) {
  const isUser = turn.role === "user";
  const isSystem = turn.role === "system";

  if (isSystem) {
    return (
      <article className="font-mono text-center text-[12px] text-[var(--text-muted)]">
        <span className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-3)] px-3 py-1">{turn.text}</span>
      </article>
    );
  }

  if (isUser) {
    return (
      <article className="flex justify-end">
        <div className="max-w-[78%]">
          <div className="mb-2 flex items-center justify-end gap-2 text-[11px] uppercase tracking-[0.16em] text-[#64748B]">
            <span>Guest</span>
          </div>
          <div className="rounded-[22px] rounded-tr-[8px] border border-[var(--line-strong)] bg-[var(--chat-user)] px-4 py-3 text-left text-[14px] leading-7 text-[var(--text-main)] shadow-[0_0_0_1px_rgba(0,255,170,0.04)_inset]">
            {turn.text}
          </div>
          <div className="mt-2 text-right text-[11px] text-[#64748B]">{formatMessageTime(turn.createdAt)}</div>
        </div>
      </article>
    );
  }

  return (
    <article className="flex items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--line-strong)] bg-[var(--surface-2)] text-[11px] font-semibold text-[var(--accent)] shadow-[0_0_16px_var(--accent-glow)]">
        TX
      </div>

      <div className="max-w-[82%]">
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[#64748B]">
          <span>Toxy</span>
          {canSpeak ? (
            <button
              aria-label={isSpeaking ? "Stop speaking" : "Speak this reply"}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                isSpeaking
                  ? "border-emerald-400/30 text-emerald-300"
                  : "border-[var(--line)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
              onClick={() => onSpeak(turn)}
              type="button"
            >
              {isSpeaking ? "stop" : "replay"}
            </button>
          ) : null}
        </div>
        <div className="rounded-[22px] rounded-tl-[8px] border border-[var(--line)] bg-[var(--chat-assistant)] px-4 py-3 text-[14px] leading-7 text-[var(--text-main)] shadow-[0_10px_24px_rgba(0,0,0,0.18)]">
          {turn.text}
        </div>
        <div className="mt-2 text-[11px] text-[#64748B]">{formatMessageTime(turn.createdAt)}</div>
      </div>
    </article>
  );
}

export function ToxyRadio({ profile, radioState: initialState, dailyPlaylist, llmConnected }: ToxyRadioProps) {
  const [radioState, setRadioState] = useState(initialState);
  const [terminalTurns, setTerminalTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isGreetingPending, setIsGreetingPending] = useState(false);
  const [isTrackSwitching, setIsTrackSwitching] = useState(false);
  const [isCommentaryPending, setIsCommentaryPending] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [actualDurationSeconds, setActualDurationSeconds] = useState(() => fallbackDuration(initialState.nowPlaying));
  const [seekValue, setSeekValue] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [volume, setVolume] = useState(0.72);
  const [, setPlaybackHistory] = useState<TrackCandidate[]>([]);
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [weatherSummary, setWeatherSummary] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeechInputSupported, setIsSpeechInputSupported] = useState(false);
  const [isSpeechOutputSupported, setIsSpeechOutputSupported] = useState(false);
  const [isServerTtsAvailable, setIsServerTtsAvailable] = useState(false);
  const [isTtsEnabled, setIsTtsEnabled] = useState(false);
  const [speakingTurnId, setSpeakingTurnId] = useState<string | null>(null);
  const [rotatingCaptionIndex, setRotatingCaptionIndex] = useState(0);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);
  const [isArtistOverflowing, setIsArtistOverflowing] = useState(false);
  const [isTerminalNearBottom, setIsTerminalNearBottom] = useState(true);
  const [isKeyboardZoneActive, setIsKeyboardZoneActive] = useState(false);
  const [companionHighlightIndex, setCompanionHighlightIndex] = useState(0);
  const [trackLyricLines, setTrackLyricLines] = useState<LyricLine[]>([]);
  const [lyricSource, setLyricSource] = useState<"lrc" | "text" | "none">("none");
  const [trackDecisionExplanation, setTrackDecisionExplanation] = useState<TrackDecisionExplanation | null>(null);
  const [isRejectedReasonsOpen, setIsRejectedReasonsOpen] = useState(false);
  const [recommendedTracks, setRecommendedTracks] = useState<TrackCandidate[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const voiceAudioRef = useRef<HTMLAudioElement>(null);
  const keyboardZoneRef = useRef<HTMLDivElement>(null);
  const terminalScrollRef = useRef<HTMLDivElement>(null);
  const titleViewportRef = useRef<HTMLDivElement>(null);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const artistViewportRef = useRef<HTMLDivElement>(null);
  const artistMeasureRef = useRef<HTMLSpanElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const messageRef = useRef("");
  const submitMessageRef = useRef<(sourceMessage?: string) => Promise<void>>(() => Promise.resolve());
  const dictatedPrefixRef = useRef("");
  const latestSpeechDraftRef = useRef("");
  const shouldAutoSendSpeechRef = useRef(false);
  const greetingRequestedRef = useRef(false);
  const coordsPromiseRef = useRef<Promise<Coordinates | null> | null>(null);
  const lastSpokenAssistantTurnIdRef = useRef<string | null>(null);
  const ttsRequestTokenRef = useRef(0);
  const voiceAudioUrlRef = useRef<string | null>(null);
  const commentaryRequestIdRef = useRef(0);
  const trackSwitchRequestIdRef = useRef(0);
  const busyRef = useRef(false);
  const lyricsRequestIdRef = useRef(0);
  const savedProgressRef = useRef<SavedProgressMap>({});
  const trackActivationRef = useRef<TrackActivationIntent | null>(null);
  const trackActivationTokenRef = useRef(0);
  const endedTrackIdRef = useRef<string | null>(null);
  const audioErrorTrackIdRef = useRef<string | null>(null);
  const lyricsAbortRef = useRef<AbortController | null>(null);
  const trackSwitchAbortRef = useRef<AbortController | null>(null);
  const commentaryAbortRef = useRef<AbortController | null>(null);

  const tasteLabels = useMemo(() => buildTasteLabels(profile, dailyPlaylist), [dailyPlaylist, profile]);
  const displayedDurationSeconds = actualDurationSeconds || fallbackDuration(radioState.nowPlaying);
  const shownElapsedSeconds = isSeeking ? seekValue : elapsedSeconds;
  const progressPercent = clamp((shownElapsedSeconds / displayedDurationSeconds) * 100, 0, 100);
  const volumePercent = clamp(volume * 100, 0, 100);
  const avatarLabel = (profile.artists[0]?.slice(0, 2) ?? "ME").toUpperCase();
  const isBusy = isPending;
  const canUseTts = isSpeechOutputSupported || isServerTtsAvailable;
  const rotatingCaptions = useMemo(
    () => buildRotatingCaptionsSafe(weatherSummary, radioState.nowPlaying),
    [radioState.nowPlaying, weatherSummary]
  );
  const activeCaption = rotatingCaptions[rotatingCaptionIndex % Math.max(rotatingCaptions.length, 1)] ?? "";
  const companionLines = useMemo(
    () => buildCompanionLines(radioState.nowPlaying, radioState, activeCaption),
    [activeCaption, radioState, radioState.nowPlaying]
  );
  const activeTrackDecisionExplanation =
    trackDecisionExplanation && trackDecisionExplanation.trackId === radioState.nowPlaying.id
      ? trackDecisionExplanation
      : null;
  const activeLyricIndex = useMemo(() => {
    if (trackLyricLines.length === 0) {
      return -1;
    }

    for (let index = trackLyricLines.length - 1; index >= 0; index -= 1) {
      if (shownElapsedSeconds >= trackLyricLines[index]!.time) {
        return index;
      }
    }

    return 0;
  }, [shownElapsedSeconds, trackLyricLines]);
  const displayedReaderRows = useMemo(() => {
    if (trackLyricLines.length === 0 || lyricSource === "none") {
      return companionLines.map((text, index) => ({
        key: `fallback-${index}-${text}`,
        text,
        time: Math.round((displayedDurationSeconds / Math.max(companionLines.length, 1)) * index),
        active: index === companionHighlightIndex % Math.max(companionLines.length, 1)
      }));
    }

    const safeActiveIndex = activeLyricIndex < 0 ? 0 : activeLyricIndex;
    const start = Math.max(0, Math.min(safeActiveIndex - 1, Math.max(0, trackLyricLines.length - 4)));
    return trackLyricLines.slice(start, start + 4).map((line, offset) => {
      const realIndex = start + offset;
      return {
        key: `lyric-${realIndex}-${line.time}-${line.text}`,
        text: line.text,
        time: Math.max(0, Math.floor(line.time)),
        active: realIndex === safeActiveIndex
      };
    });
  }, [activeLyricIndex, companionHighlightIndex, companionLines, displayedDurationSeconds, lyricSource, trackLyricLines]);
  const currentTitleClassName = trackTitleClassName(radioState.nowPlaying.title);
  const titleMarqueeDuration = trackTitleMarqueeDuration(radioState.nowPlaying.title);
  const artistMarqueeDuration = trackArtistMarqueeDuration(radioState.nowPlaying.artist);

  function readSavedProgress(track: Pick<TrackCandidate, "provider" | "providerTrackId">) {
    const key = progressStorageKey(track);
    const fromMemory = savedProgressRef.current[key];
    if (typeof fromMemory === "number" && Number.isFinite(fromMemory) && fromMemory >= 0) {
      return fromMemory;
    }

    if (typeof window === "undefined") {
      return 0;
    }

    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function writeSavedProgress(track: Pick<TrackCandidate, "provider" | "providerTrackId">, value: number) {
    const key = progressStorageKey(track);
    const safeValue = Math.max(0, value);
    savedProgressRef.current[key] = safeValue;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, String(safeValue));
    }
  }

  function clearSavedProgress(track: Pick<TrackCandidate, "provider" | "providerTrackId">) {
    const key = progressStorageKey(track);
    delete savedProgressRef.current[key];

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(key);
    }
  }

  function getResumePlaybackIntent() {
    const audio = audioRef.current;
    if (audio) {
      return !audio.paused && !audio.ended;
    }

    return isPlaying;
  }

  function primeTrackActivation(
    track: Pick<TrackCandidate, "id" | "provider" | "providerTrackId">,
    options?: {
      resetProgress?: boolean;
      resumePlayback?: boolean;
    }
  ) {
    const resetProgress = options?.resetProgress ?? true;
    const resumePlayback = options?.resumePlayback ?? getResumePlaybackIntent();
    trackActivationTokenRef.current += 1;
    trackActivationRef.current = {
      trackId: track.id,
      activationToken: trackActivationTokenRef.current,
      resetProgress,
      resumePlayback
    };

    if (resetProgress) {
      clearSavedProgress(track);
    }

    setActualDurationSeconds(fallbackDuration(track as TrackCandidate));
    setElapsedSeconds(0);
    setSeekValue(0);
    setIsPlaying(resumePlayback);
  }

  function isTrackActivationCurrent(trackId: string, activationToken: number) {
    return trackActivationTokenRef.current === activationToken && radioState.nowPlaying.id === trackId;
  }

  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  useEffect(() => {
    submitMessageRef.current = submitMessage;
  });

  useEffect(() => {
    busyRef.current = isBusy || isTrackSwitching;
  }, [isBusy, isTrackSwitching]);

  useEffect(() => {
    lyricsRequestIdRef.current += 1;
    const requestId = lyricsRequestIdRef.current;
    lyricsAbortRef.current?.abort();
    const controller = new AbortController();
    lyricsAbortRef.current = controller;

    async function loadLyrics() {
      try {
        const response = await fetch(
          `/api/lyrics/current?provider=${encodeURIComponent(radioState.nowPlaying.provider)}&providerTrackId=${encodeURIComponent(
            radioState.nowPlaying.providerTrackId
          )}`,
          {
            cache: "no-store",
            signal: controller.signal
          }
        );

        if (!response.ok) {
          throw new Error("Lyrics request failed");
        }

        const payload = (await response.json()) as LyricsResponsePayload;
        if (lyricsRequestIdRef.current !== requestId) {
          return;
        }

        setTrackLyricLines(payload.lines ?? []);
        setLyricSource(payload.source ?? "none");
      } catch {
        if (controller.signal.aborted || lyricsRequestIdRef.current !== requestId) {
          return;
        }

        setTrackLyricLines([]);
        setLyricSource("none");
      }
    }

    void loadLyrics();

    return () => {
      controller.abort();
      if (lyricsAbortRef.current === controller) {
        lyricsAbortRef.current = null;
      }
    };
  }, [radioState.nowPlaying.provider, radioState.nowPlaying.providerTrackId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const viewport = titleViewportRef.current;
    const title = titleMeasureRef.current;
    if (!viewport || !title || typeof window === "undefined") {
      return;
    }

    const updateOverflow = () => {
      setIsTitleOverflowing(title.scrollWidth - viewport.clientWidth > 12);
    };

    updateOverflow();

    const observer = new ResizeObserver(() => updateOverflow());
    observer.observe(viewport);
    observer.observe(title);
    window.addEventListener("resize", updateOverflow);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [currentTitleClassName, radioState.nowPlaying.title]);

  useEffect(() => {
    const viewport = artistViewportRef.current;
    const artist = artistMeasureRef.current;
    if (!viewport || !artist || typeof window === "undefined") {
      return;
    }

    const updateOverflow = () => {
      setIsArtistOverflowing(artist.scrollWidth - viewport.clientWidth > 12);
    };

    updateOverflow();

    const observer = new ResizeObserver(() => updateOverflow());
    observer.observe(viewport);
    observer.observe(artist);
    window.addEventListener("resize", updateOverflow);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [radioState.nowPlaying.artist]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedTheme = window.localStorage.getItem("toxy-theme");
    if (storedTheme === "dark" || storedTheme === "light") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("toxy-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedTts = window.localStorage.getItem("toxy-tts-enabled");
    if (storedTts === "true") {
      setIsTtsEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("toxy-tts-enabled", String(isTtsEnabled));
  }, [isTtsEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextSavedProgress: SavedProgressMap = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith("toxy-progress:")) {
        continue;
      }

      const raw = window.localStorage.getItem(key);
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed) && parsed >= 0) {
        nextSavedProgress[key] = parsed;
      }
    }

    savedProgressRef.current = nextSavedProgress;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/tts")
      .then(async (response) => {
        if (!response.ok) {
          return { available: false };
        }

        return (await response.json()) as { available?: boolean };
      })
      .then((payload) => {
        if (!cancelled) {
          setIsServerTtsAvailable(payload.available === true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsServerTtsAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const recognitionApi = (
      (window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
      (window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor })
        .webkitSpeechRecognition
    ) as SpeechRecognitionConstructor | undefined;

    setIsSpeechOutputSupported(typeof window.speechSynthesis !== "undefined");

    if (!recognitionApi) {
      return;
    }

    const recognition = new recognitionApi();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";

    recognition.onresult = (event) => {
      let transcript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }

      const prefix = dictatedPrefixRef.current;
      const nextMessage = (prefix ? `${prefix}${transcript}` : transcript).trim();
      latestSpeechDraftRef.current = nextMessage;
      messageRef.current = nextMessage;
      setMessage(nextMessage);
    };

    recognition.onerror = () => {
      shouldAutoSendSpeechRef.current = false;
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);

      if (!shouldAutoSendSpeechRef.current) {
        return;
      }

      shouldAutoSendSpeechRef.current = false;
      const spokenMessage = latestSpeechDraftRef.current.trim();
      if (!spokenMessage || busyRef.current) {
        return;
      }

      void submitMessageRef.current(spokenMessage);
    };

    recognitionRef.current = recognition;
    setIsSpeechInputSupported(true);

    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalScrollRef.current;
    if (!terminal) {
      return;
    }

    if (!isTerminalNearBottom) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      terminal.scrollTo({
        top: terminal.scrollHeight,
        behavior: terminal.scrollTop > 0 ? "smooth" : "auto"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isBusy, isTerminalNearBottom, terminalTurns]);

  useEffect(() => {
    return () => {
      lyricsAbortRef.current?.abort();
      trackSwitchAbortRef.current?.abort();
      commentaryAbortRef.current?.abort();

      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }

      voiceAudioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (rotatingCaptions.length <= 1) {
      setRotatingCaptionIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setRotatingCaptionIndex((current) => (current + 1) % rotatingCaptions.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, [rotatingCaptions.length]);

  useEffect(() => {
    setCompanionHighlightIndex(0);
  }, [companionLines]);

  useEffect(() => {
    if (lyricSource !== "none" && trackLyricLines.length > 0) {
      setCompanionHighlightIndex(0);
      return;
    }

    if (companionLines.length <= 1) {
      setCompanionHighlightIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setCompanionHighlightIndex((current) => (current + 1) % companionLines.length);
    }, 2200);

    return () => window.clearInterval(timer);
  }, [companionLines, lyricSource, trackLyricLines.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const primedActivation = trackActivationRef.current?.trackId === radioState.nowPlaying.id ? trackActivationRef.current : null;
    if (!primedActivation) {
      trackActivationTokenRef.current += 1;
    }

    const activationToken = primedActivation?.activationToken ?? trackActivationTokenRef.current;
    const shouldResetProgress = primedActivation?.resetProgress ?? false;
    const shouldResumePlayback = primedActivation?.resumePlayback ?? false;
    const savedProgress = shouldResetProgress ? 0 : readSavedProgress(radioState.nowPlaying);

    setActualDurationSeconds(fallbackDuration(radioState.nowPlaying));
    setElapsedSeconds(Math.round(savedProgress));
    setSeekValue(Math.round(savedProgress));
    audioErrorTrackIdRef.current = null;

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.src = radioState.nowPlaying.streamUrl;
    audio.playbackRate = 1;
    audio.load();
    endedTrackIdRef.current = null;
    let hasAppliedActivation = false;
    let hasRequestedPlayback = false;

    const syncTrackActivation = () => {
      if (!isTrackActivationCurrent(radioState.nowPlaying.id, activationToken)) {
        return;
      }

      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackDuration(radioState.nowPlaying);
      setActualDurationSeconds(Math.round(duration));

      if (!hasAppliedActivation) {
        const nextElapsed = shouldResetProgress ? 0 : clamp(savedProgress, 0, duration);
        if (Math.abs(audio.currentTime - nextElapsed) > 0.5) {
          audio.currentTime = nextElapsed;
        }

        setElapsedSeconds(Math.round(nextElapsed));
        setSeekValue(Math.round(nextElapsed));
        hasAppliedActivation = true;
        if (trackActivationRef.current?.trackId === radioState.nowPlaying.id && trackActivationRef.current.activationToken === activationToken) {
          trackActivationRef.current = {
            ...trackActivationRef.current,
            resetProgress: false
          };
        }
      }

      if (!shouldResumePlayback) {
        audio.pause();
        setIsPlaying(false);
        return;
      }

      if (hasRequestedPlayback) {
        return;
      }

      hasRequestedPlayback = true;
      void audio
        .play()
        .then(() => {
          if (isTrackActivationCurrent(radioState.nowPlaying.id, activationToken)) {
            audioErrorTrackIdRef.current = null;
            setIsPlaying(true);
          }
        })
        .catch(() => {
          if (isTrackActivationCurrent(radioState.nowPlaying.id, activationToken)) {
            setIsPlaying(false);
          }
        });
    };

    audio.addEventListener("loadedmetadata", syncTrackActivation);
    audio.addEventListener("canplay", syncTrackActivation);

    return () => {
      audio.removeEventListener("loadedmetadata", syncTrackActivation);
      audio.removeEventListener("canplay", syncTrackActivation);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [radioState.nowPlaying.id, radioState.nowPlaying.streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const syncDuration = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackDuration(radioState.nowPlaying);
      setActualDurationSeconds(Math.round(duration));
    };

    const syncElapsed = () => {
      if (isSeeking) {
        return;
      }

      if (!Number.isFinite(audio.currentTime)) {
        return;
      }

      const nextElapsed = Math.round(audio.currentTime);
      setElapsedSeconds(nextElapsed);
      writeSavedProgress(radioState.nowPlaying, nextElapsed);
    };

    const persistElapsed = () => {
      if (!Number.isFinite(audio.currentTime)) {
        return;
      }

      writeSavedProgress(radioState.nowPlaying, Math.round(audio.currentTime));
    };

    const handleEnded = () => {
      if (endedTrackIdRef.current === radioState.nowPlaying.id) {
        return;
      }

      endedTrackIdRef.current = radioState.nowPlaying.id;
      clearSavedProgress(radioState.nowPlaying);
      setElapsedSeconds(0);
      setSeekValue(0);
      setIsPlaying(true);
      void nextTrack({ resumePlayback: true, message: "Next track." });
    };

    const handleError = () => {
      if (audioErrorTrackIdRef.current === radioState.nowPlaying.id) {
        return;
      }

      audioErrorTrackIdRef.current = radioState.nowPlaying.id;
      setIsPlaying(false);
      setTerminalTurns((current) => [
        ...current,
        buildLocalSystemTurn(`Audio failed for ${radioState.nowPlaying.title}. Skipping to the next playable track.`)
      ]);
      void nextTrack({ resumePlayback: true, message: "Skip broken audio source." });
    };

    syncDuration();
    syncElapsed();

    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("timeupdate", syncElapsed);
    audio.addEventListener("pause", persistElapsed);
    audio.addEventListener("seeked", persistElapsed);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("timeupdate", syncElapsed);
      audio.removeEventListener("pause", persistElapsed);
      audio.removeEventListener("seeked", persistElapsed);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [isSeeking, radioState.nowPlaying.id]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const zone = keyboardZoneRef.current;
      const target = event.target;
      if (!(target instanceof Node) || !zone) {
        setIsKeyboardZoneActive(false);
        return;
      }

      setIsKeyboardZoneActive(zone.contains(target));
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  useEffect(() => {
    if (greetingRequestedRef.current) {
      return;
    }

    greetingRequestedRef.current = true;
    setTerminalTurns([]);
    void requestGreeting(true);
  }, []);

  async function resolveBrowserCoordinates() {
    if (coords) {
      return coords;
    }

    if (coordsPromiseRef.current) {
      return coordsPromiseRef.current;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return null;
    }

    coordsPromiseRef.current = new Promise<Coordinates | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const nextCoords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };

          setCoords(nextCoords);
          resolve(nextCoords);
        },
        () => resolve(null),
        {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 1000 * 60 * 10
        }
      );
    }).finally(() => {
      coordsPromiseRef.current = null;
    });

    return coordsPromiseRef.current;
  }

  function stopCurrentSpeech() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    const voiceAudio = voiceAudioRef.current;
    if (voiceAudio) {
      voiceAudio.pause();
      voiceAudio.currentTime = 0;
      voiceAudio.removeAttribute("src");
      voiceAudio.load();
    }

    if (voiceAudioUrlRef.current) {
      URL.revokeObjectURL(voiceAudioUrlRef.current);
      voiceAudioUrlRef.current = null;
    }

    ttsRequestTokenRef.current += 1;
    setSpeakingTurnId(null);
  }

  function applyRadioState(
    nextState: RadioState,
    syncTurns = true,
    decision?: {
      why_selected?: WhySelectedEntry[];
      why_rejected?: WhyRejectedEntry[];
      selectionStatus?: "picked" | "candidate_required" | "fallback_demo";
      candidateTracks?: TrackCandidate[];
    }
  ) {
    const selectedReasons = decision?.why_selected?.slice(0, 3) ?? [];
    const rejectedReasons = decision?.why_rejected?.slice(0, 3) ?? [];
    const hasDecisionReasons = selectedReasons.length > 0 || rejectedReasons.length > 0;

    if (hasDecisionReasons) {
      setTrackDecisionExplanation({
        trackId: nextState.nowPlaying.id,
        why_selected: selectedReasons,
        why_rejected: rejectedReasons
      });
      setIsRejectedReasonsOpen(false);
    } else if (radioState.nowPlaying.id !== nextState.nowPlaying.id) {
      setTrackDecisionExplanation(null);
      setIsRejectedReasonsOpen(false);
    }

    if (decision?.selectionStatus === "candidate_required" && (decision.candidateTracks?.length ?? 0) > 0) {
      setRecommendedTracks((decision.candidateTracks ?? []).slice(0, 5));
    } else if (decision?.selectionStatus === "picked") {
      setRecommendedTracks([]);
    }

    setPlaybackHistory((current) => {
      if (radioState.nowPlaying.id === nextState.nowPlaying.id) {
        return current;
      }

      return [...current, radioState.nowPlaying].slice(-8);
    });

    startTransition(() => {
      setRadioState(nextState);
      if (syncTurns) {
        setTerminalTurns(nextState.chatHistory);
      }
    });
  }

  async function requestGreeting(reset: boolean) {
    if (reset) {
      setTerminalTurns([]);
      lastSpokenAssistantTurnIdRef.current = null;
      stopCurrentSpeech();
    }

    setIsGreetingPending(true);

    const sendGreetingRequest = async (payload: { reset: boolean; latitude?: number; longitude?: number }) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      let response: Response;

      try {
        response = await fetch("/api/chat/greeting", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        window.clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error("Greeting request failed");
      }

      const result = (await response.json()) as GreetingResponsePayload;
      setWeatherSummary(result.weatherSummary ?? "");
      applyRadioState(result.radioState, true);
    };

    try {
      const latestCoords = await resolveBrowserCoordinates();
      if (latestCoords) {
        await sendGreetingRequest({
          reset,
          latitude: latestCoords.latitude,
          longitude: latestCoords.longitude
        });
      } else {
        await sendGreetingRequest({ reset });
      }
    } catch (error) {
      setTerminalTurns((current) => [
        ...current,
        buildLocalSystemTurn(error instanceof Error ? error.message : "Unable to create a fresh greeting right now.")
      ]);
    } finally {
      setIsGreetingPending(false);
    }
  }

  function playRecommendedTrack(track: TrackCandidate, sourceMessage: string) {
    setRecommendedTracks([]);
    void triggerTrackSwitch(
      {
        type: "track_query",
        query: toPlayableTrackQuery(track)
      },
      {
        message: sourceMessage,
        persistUserTurn: true
      }
    );
  }

  async function submitMessage(sourceMessage?: string) {
    const trimmed = (sourceMessage ?? messageRef.current).trim();
    if (!trimmed || isBusy) {
      return;
    }

    const optimisticUserTurn: ChatTurn = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      text: trimmed,
      createdAt: new Date().toISOString()
    };

    setTerminalTurns((current) => [...current, optimisticUserTurn]);
    latestSpeechDraftRef.current = "";
    messageRef.current = "";
    setMessage("");

    if (recommendedTracks.length > 0) {
      const recommendationIndex = parseRecommendationChoice(trimmed, recommendedTracks.length);
      if (recommendationIndex !== null) {
        const picked = recommendedTracks[recommendationIndex];
        if (picked) {
          playRecommendedTrack(picked, trimmed);
          return;
        }
      }
    }

    const controlIntent = parseControlIntent(trimmed);
    if (controlIntent.type !== "none") {
      void triggerTrackSwitch(controlIntent, {
        message: trimmed,
        persistUserTurn: true
      });
      return;
    }

    setIsPending(true);

    try {
      const payload = await requestJsonWithTimeout<ChatResponsePayload>("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        timeoutMs: 15000,
        retries: 1,
        body: JSON.stringify({
          message: trimmed,
          latitude: coords?.latitude,
          longitude: coords?.longitude
        })
      });
      if (payload.weatherSummary) {
        setWeatherSummary(payload.weatherSummary);
      }
      applyRadioState(payload.radioState, true, payload);
    } catch (error) {
      setTerminalTurns((current) => [
        ...current,
        buildLocalSystemTurn(error instanceof Error ? error.message : "Unable to reach the booth right now.")
      ]);
    } finally {
      setIsPending(false);
    }
  }

  function handleKeyboardZoneKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!isKeyboardZoneActive || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (isHotkeyBlockedTarget(event.target)) {
      return;
    }

    if (event.repeat && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      return;
    }

    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      void togglePlayback();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      void nextTrack();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      previousTrack();
    }
  }

  function activateKeyboardZoneFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const zone = keyboardZoneRef.current;
    if (!zone) {
      return;
    }

    setIsKeyboardZoneActive(true);
    if (!isHotkeyBlockedTarget(event.target)) {
      zone.focus({ preventScroll: true });
    }
  }

  function handleKeyboardZoneFocus() {
    setIsKeyboardZoneActive(true);
  }

  function handleKeyboardZoneBlur() {
    const zone = keyboardZoneRef.current;
    window.setTimeout(() => {
      if (!zone) {
        setIsKeyboardZoneActive(false);
        return;
      }

      const activeElement = document.activeElement;
      setIsKeyboardZoneActive(Boolean(activeElement && zone.contains(activeElement)));
    }, 0);
  }

  async function requestTrackCommentary(
    action: ChatControlIntent,
    expectedTrackId: string,
    switchToken: string,
    requestId: number,
    message?: string
  ) {
    setIsCommentaryPending(true);
    commentaryAbortRef.current?.abort();
    const controller = new AbortController();
    commentaryAbortRef.current = controller;

    try {
      const payload = await requestJsonWithTimeout<RadioCommentaryPayload>("/api/radio/select/commentary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        timeoutMs: 12000,
        retries: 0,
        body: JSON.stringify({
          ...toRadioSelectRequestBody(action, message),
          expectedTrackId,
          switchToken
        })
      });
      if (controller.signal.aborted || commentaryRequestIdRef.current !== requestId || payload.skipped) {
        return;
      }

      applyRadioState(payload.radioState, true, payload);
    } catch {
      if (controller.signal.aborted) {
        return;
      }

      return;
    } finally {
      if (commentaryRequestIdRef.current === requestId) {
        setIsCommentaryPending(false);
      }

      if (commentaryAbortRef.current === controller) {
        commentaryAbortRef.current = null;
      }
    }
  }

  async function triggerTrackSwitch(
    action: ChatControlIntent,
    options?: {
      message?: string;
      persistUserTurn?: boolean;
      resumePlayback?: boolean;
    }
  ) {
    if (isBusy) {
      return;
    }

    trackSwitchAbortRef.current?.abort();
    commentaryAbortRef.current?.abort();
    const controller = new AbortController();
    trackSwitchAbortRef.current = controller;
    trackSwitchRequestIdRef.current += 1;
    const trackSwitchRequestId = trackSwitchRequestIdRef.current;
    setIsTrackSwitching(true);
    setIsCommentaryPending(false);
    commentaryRequestIdRef.current += 1;
    const commentaryRequestId = commentaryRequestIdRef.current;
    stopCurrentSpeech();

    try {
      const payload = await requestJsonWithTimeout<RadioSelectPayload>("/api/radio/select", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        timeoutMs: 12000,
        retries: 1,
        body: JSON.stringify({
          ...toRadioSelectRequestBody(action, options?.message),
          persistUserTurn: options?.persistUserTurn === true
        })
      });
      if (controller.signal.aborted || trackSwitchRequestIdRef.current !== trackSwitchRequestId) {
        return;
      }

      if (payload.selectionStatus === "picked") {
        primeTrackActivation(payload.radioState.nowPlaying, {
          resumePlayback: options?.resumePlayback
        });
      }
      applyRadioState(payload.radioState, true, payload);

      if (payload.selectionStatus === "picked" && payload.switchToken) {
        void requestTrackCommentary(
          action,
          payload.radioState.nowPlaying.id,
          payload.switchToken,
          commentaryRequestId,
          options?.message
        );
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setTerminalTurns((current) => [
        ...current,
        buildLocalSystemTurn(error instanceof Error ? error.message : "Unable to retune the booth right now.")
      ]);
    } finally {
      if (trackSwitchRequestIdRef.current === trackSwitchRequestId) {
        setIsTrackSwitching(false);
      }

      if (trackSwitchAbortRef.current === controller) {
        trackSwitchAbortRef.current = null;
      }
    }
  }

  async function nextTrack(options?: { resumePlayback?: boolean; message?: string }) {
    await triggerTrackSwitch(
      { type: "next" },
      {
        message: options?.message ?? "Next track.",
        resumePlayback: options?.resumePlayback
      }
    );
  }

  function previousTrack(options?: { resumePlayback?: boolean }) {
    setPlaybackHistory((current) => {
      const previous = current.at(-1);
      if (!previous) {
        return current;
      }

      trackSwitchAbortRef.current?.abort();
      commentaryAbortRef.current?.abort();
      trackSwitchRequestIdRef.current += 1;
      commentaryRequestIdRef.current += 1;
      setIsTrackSwitching(false);
      setIsCommentaryPending(false);
      stopCurrentSpeech();
      setTrackDecisionExplanation(null);
      setIsRejectedReasonsOpen(false);
      primeTrackActivation(previous, {
        resumePlayback: options?.resumePlayback
      });

      startTransition(() => {
        setRadioState((state) => ({
          ...state,
          nowPlaying: previous,
          queue: [state.nowPlaying, ...state.queue].slice(0, 3),
          updatedAt: new Date().toISOString(),
          onAirLine: "Rewound one step inside the booth memory.",
          lastReason: "Rolled back to the previous record without leaving the current station atmosphere."
        }));
      });

      return current.slice(0, -1);
    });
  }

  function commitSeek(nextValue: number) {
    const audio = audioRef.current;
    const fallbackMax = Math.max(1, displayedDurationSeconds);
    const duration =
      audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackMax;
    const clampedValue = clamp(nextValue, 0, duration);

    setSeekValue(clampedValue);
    setElapsedSeconds(clampedValue);
    writeSavedProgress(radioState.nowPlaying, clampedValue);

    if (!audio) {
      return;
    }

    try {
      audio.currentTime = clampedValue;
    } catch {
      return;
    }
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }

  function handleSeekChange(nextValue: number) {
    commitSeek(nextValue);
  }

  function handleTerminalScroll() {
    const terminal = terminalScrollRef.current;
    if (!terminal) {
      return;
    }

    const distanceFromBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight;
    setIsTerminalNearBottom(distanceFromBottom < 48);
  }

  function toggleSpeechInput() {
    const recognition = recognitionRef.current;
    if (!recognition) {
      return;
    }

    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }

    dictatedPrefixRef.current = messageRef.current.trim().length > 0 ? `${messageRef.current.trim()} ` : "";
    latestSpeechDraftRef.current = messageRef.current.trim();
    shouldAutoSendSpeechRef.current = true;
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      shouldAutoSendSpeechRef.current = false;
      setIsListening(false);
    }
  }

  async function playServerSpeech(turn: ChatTurn) {
    if (!isServerTtsAvailable) {
      return false;
    }

    if (speakingTurnId === turn.id) {
      stopCurrentSpeech();
      return true;
    }

    stopCurrentSpeech();
    const requestToken = ttsRequestTokenRef.current;
    setSpeakingTurnId(turn.id);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: turn.text })
      });

      if (!response.ok) {
        throw new Error("Server TTS request failed");
      }

      const blob = await response.blob();
      if (requestToken !== ttsRequestTokenRef.current) {
        return true;
      }

      const audioUrl = URL.createObjectURL(blob);
      voiceAudioUrlRef.current = audioUrl;
      const voiceAudio = voiceAudioRef.current;
      if (!voiceAudio) {
        URL.revokeObjectURL(audioUrl);
        voiceAudioUrlRef.current = null;
        setSpeakingTurnId(null);
        return true;
      }

      voiceAudio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        voiceAudioUrlRef.current = null;
        setSpeakingTurnId(null);
      };
      voiceAudio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        voiceAudioUrlRef.current = null;
        setSpeakingTurnId(null);
      };
      voiceAudio.src = audioUrl;
      await voiceAudio.play();
      return true;
    } catch {
      setSpeakingTurnId(null);
      return false;
    }
  }

  async function speakTurn(turn: ChatTurn) {
    if (speakingTurnId === turn.id) {
      stopCurrentSpeech();
      return;
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        stopCurrentSpeech();
        const utterance = new SpeechSynthesisUtterance(turn.text);
        utterance.lang = /[\u4e00-\u9fff]/.test(turn.text) ? "zh-CN" : "en-US";
        utterance.rate = 1;
        utterance.onend = () => setSpeakingTurnId(null);
        utterance.onerror = async () => {
          setSpeakingTurnId(null);
          await playServerSpeech(turn);
        };
        setSpeakingTurnId(turn.id);
        window.speechSynthesis.speak(utterance);
        return;
      } catch {}
    }

    await playServerSpeech(turn);
  }

  useEffect(() => {
    if (!isTtsEnabled || isBusy || isTrackSwitching || isCommentaryPending) {
      return;
    }

    const lastAssistantTurn = [...terminalTurns].reverse().find((turn) => turn.role === "assistant");
    if (!lastAssistantTurn) {
      return;
    }

    if (lastSpokenAssistantTurnIdRef.current === lastAssistantTurn.id) {
      return;
    }

    void speakTurn(lastAssistantTurn).then(() => {
      lastSpokenAssistantTurnIdRef.current = lastAssistantTurn.id;
    });
  }, [isBusy, isCommentaryPending, isTrackSwitching, isTtsEnabled, terminalTurns]);

  return (
    <main className={`toxy-theme-${theme} relative min-h-screen overflow-x-hidden bg-[var(--page-bg)] px-4 py-6 text-[var(--text-main)] md:px-8 md:py-8`}>
      <audio preload="metadata" ref={audioRef} />
      <audio preload="none" ref={voiceAudioRef} />

      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_16%,var(--violet-haze),transparent_24%),radial-gradient(circle_at_82%_12%,var(--page-secondary-halo),transparent_26%),radial-gradient(circle_at_50%_50%,var(--mist-overlay),transparent_62%)] opacity-95" />
      <div className="toxy-dot-field pointer-events-none fixed inset-0" />
      <div className="toxy-dot-field toxy-dot-field-secondary pointer-events-none fixed inset-0" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_center,transparent_56%,rgba(0,0,0,0.28)_100%)]" />

      <div className="relative mx-auto max-w-[1120px]">
        <motion.section
          animate="show"
          className="toxy-shell-surface relative w-full overflow-hidden rounded-[36px] border border-[var(--line)] bg-[var(--phone-bg)]"
          initial="hidden"
          style={{ boxShadow: "var(--phone-shadow)" }}
        >
          <div className="toxy-shell-mist pointer-events-none absolute inset-0" />
          <div className="toxy-shell-grain pointer-events-none absolute inset-0" />
          <div className="toxy-shell-edge-glow pointer-events-none absolute inset-0" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,var(--page-halo),transparent_28%),radial-gradient(circle_at_80%_18%,var(--page-secondary-halo),transparent_24%),radial-gradient(var(--dot-color)_1.05px,transparent_1.05px)] bg-[length:auto,auto,14px_14px]" />
          <div className="pointer-events-none absolute inset-0 opacity-78 bg-[radial-gradient(var(--module-dot-color)_1px,transparent_1px)] bg-[length:15px_15px]" />
          <div className="pointer-events-none absolute inset-[12px] rounded-[28px] border border-[var(--inner-line)]" />

          <div className="relative z-10">
            <motion.header className="flex items-center justify-between px-5 pb-4 pt-5 md:px-7" custom={0} variants={fadeUp}>
              <button
                aria-label="Open taste profile"
                className="group relative grid h-11 w-11 place-items-center overflow-hidden rounded-full border border-[var(--line-strong)] bg-[var(--surface-2)] text-[11px] font-semibold text-[var(--accent)] shadow-[0_0_16px_var(--accent-glow)] transition-transform duration-150 hover:-translate-y-0.5"
                onClick={() => setIsProfileDrawerOpen(true)}
                type="button"
              >
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,var(--accent-soft),transparent_64%)]" />
                <span className="relative">{avatarLabel}</span>
              </button>

              <div className="flex-1 px-3 text-center">
                <div className="font-['DotGothic16'] text-[20px] uppercase tracking-[0.18em] text-[var(--headline)] [text-shadow:0_0_14px_var(--headline-shadow)]">
                  Toxy FM
                </div>
              </div>

              <div className="toxy-theme-toggle flex items-center rounded-full border border-[var(--line)] bg-[var(--surface-3)] p-1">
                {(["light", "dark"] as const).map((mode) => (
                  <button
                    className={`rounded-full px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                      theme === mode
                        ? "bg-[var(--toggle-active-bg)] text-[var(--toggle-active-text)] shadow-[0_0_12px_var(--accent-glow)]"
                        : "text-[var(--text-muted)]"
                    }`}
                    key={mode}
                    onClick={() => setTheme(mode)}
                    type="button"
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </motion.header>

            <div
              className={`px-5 pb-5 md:px-7 md:pb-7 ${isKeyboardZoneActive ? "toxy-key-zone-active" : "toxy-key-zone-idle"}`}
              onBlurCapture={handleKeyboardZoneBlur}
              onFocusCapture={handleKeyboardZoneFocus}
              onKeyDown={handleKeyboardZoneKeyDown}
              onPointerDownCapture={activateKeyboardZoneFromPointer}
              ref={keyboardZoneRef}
              tabIndex={0}
            >
              <motion.section className="toxy-panel overflow-hidden rounded-[30px] border border-[var(--line)] p-5 backdrop-blur md:p-6" custom={1} variants={fadeUp}>
                <div className="grid gap-7">
                  <div className="border-b border-[var(--line)] pb-7 text-center">
                    <div className="font-['DotGothic16'] text-[64px] leading-none tracking-[0.08em] text-[var(--display)] [text-shadow:0_0_18px_var(--headline-shadow)] md:text-[84px]">
                      {formatClock(clock)}
                    </div>
                    <div className="mt-4 text-[14px] text-[#64748B]">{formatDate(clock)}</div>
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--surface-3)] px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-[var(--accent)]">
                      <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_14px_var(--accent-glow)] animate-[toxy-pulse_1.8s_ease-in-out_infinite]" />
                      ON AIR
                    </div>
                    <div className="toxy-caption-frame mx-auto mt-6 w-full max-w-[min(100%,34rem)] text-[13px] text-[#64748B] md:max-w-[min(100%,42rem)]">
                      <AnimatePresence mode="wait">
                        <motion.p
                          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                          className="toxy-caption-text m-0"
                          exit={{ opacity: 0, filter: "blur(8px)", y: -4 }}
                          initial={{ opacity: 0, filter: "blur(10px)", y: 4 }}
                          key={`${rotatingCaptionIndex}-${activeCaption}`}
                          transition={{ duration: 0.9, ease: "easeInOut" }}
                        >
                          {activeCaption}
                        </motion.p>
                      </AnimatePresence>
                    </div>
                  </div>

                  <div className="flex w-full max-w-full flex-col justify-between overflow-hidden">
                    <div className="grid grid-cols-[minmax(0,1fr)_80px] items-start gap-4">
                      <div className="min-w-0 overflow-hidden">
                        <div className="text-[10px] uppercase tracking-[0.22em] text-[#64748B]">Now playing</div>
                        <div className="mt-2 overflow-hidden" ref={titleViewportRef}>
                          <div
                            className={isTitleOverflowing ? "toxy-marquee-track" : "block"}
                            style={
                              isTitleOverflowing
                                ? ({ "--marquee-duration": titleMarqueeDuration } as CSSProperties)
                                : undefined
                            }
                          >
                            <span
                              className={`block leading-none text-[var(--text-main)] ${currentTitleClassName} ${
                                isTitleOverflowing ? "shrink-0 pr-8" : "truncate"
                              }`}
                              ref={titleMeasureRef}
                            >
                              {radioState.nowPlaying.title}
                            </span>
                            {isTitleOverflowing ? (
                              <span
                                aria-hidden="true"
                                className={`block shrink-0 pr-8 leading-none text-[var(--text-main)] ${currentTitleClassName}`}
                              >
                                {radioState.nowPlaying.title}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-2 overflow-hidden" ref={artistViewportRef}>
                          <div
                            className={isArtistOverflowing ? "toxy-marquee-track" : "block"}
                            style={
                              isArtistOverflowing
                                ? ({ "--marquee-duration": artistMarqueeDuration } as CSSProperties)
                                : undefined
                            }
                          >
                            <span
                              className={`block text-[15px] text-[#64748B] ${isArtistOverflowing ? "shrink-0 pr-8" : "truncate"}`}
                              ref={artistMeasureRef}
                            >
                              {radioState.nowPlaying.artist}
                            </span>
                            {isArtistOverflowing ? (
                              <span aria-hidden="true" className="block shrink-0 pr-8 text-[15px] text-[#64748B]">
                                {radioState.nowPlaying.artist}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <Image
                        alt={`${radioState.nowPlaying.title} cover`}
                        className="h-20 w-20 shrink-0 rounded-[22px] border border-[var(--line-strong)] object-cover shadow-[0_0_28px_rgba(224,188,143,0.14)]"
                        height={80}
                        priority
                        src={radioState.nowPlaying.coverUrl}
                        unoptimized
                        width={80}
                      />
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {radioState.nowPlaying.tags.slice(0, 3).map((tag) => (
                        <span
                          className="rounded-[8px] border border-[var(--line)] bg-[var(--surface-3)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[#64748B]"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {activeTrackDecisionExplanation ? (
                      <section className="mt-5 rounded-[16px] border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3">
                        <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">Why this track</div>
                        <div className="space-y-2">
                          {activeTrackDecisionExplanation.why_selected.map((reason) => (
                            <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" key={`${reason.label}-${reason.detail}`}>
                              <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-main)]">
                                <span>{reason.label.replace(/_/g, " ")}</span>
                                <span className="text-[var(--accent)]">+{reason.scoreDelta.toFixed(2)}</span>
                              </div>
                              <p className="mt-1 m-0 text-[12px] leading-5 text-[var(--text-muted)]">{reason.detail}</p>
                            </div>
                          ))}
                        </div>
                        {activeTrackDecisionExplanation.why_rejected.length > 0 ? (
                          <div className="mt-3">
                            <button
                              className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-soft)] transition-colors hover:text-[var(--text-main)]"
                              onClick={() => setIsRejectedReasonsOpen((current) => !current)}
                              type="button"
                            >
                              {isRejectedReasonsOpen ? "Hide alternatives" : "Show alternatives"}
                            </button>
                            {isRejectedReasonsOpen ? (
                              <div className="mt-2 space-y-2">
                                {activeTrackDecisionExplanation.why_rejected.map((reason) => (
                                  <div className="rounded-[10px] border border-[var(--line)] bg-[rgba(0,0,0,0.18)] px-2.5 py-2" key={`${reason.trackId}-${reason.detail}`}>
                                    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-main)]">
                                      <span className="truncate">{reason.title} - {reason.artist}</span>
                                      <span className="text-[#FCA5A5]">{reason.scoreDelta.toFixed(2)}</span>
                                    </div>
                                    <p className="mt-1 m-0 text-[12px] leading-5 text-[var(--text-muted)]">{reason.detail}</p>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </section>
                    ) : null}

                    <div className="mt-5">
                      <div className="mb-2 flex items-center justify-between text-[11px] text-[#64748B]">
                        <span>{formatTrackTime(shownElapsedSeconds)}</span>
                        <span>{formatTrackTime(displayedDurationSeconds)}</span>
                      </div>
                      <input
                        className="toxy-slider w-full"
                        max={displayedDurationSeconds}
                        min={0}
                        onBlur={() => setIsSeeking(false)}
                        onChange={(event) => handleSeekChange(Number(event.target.value))}
                        onMouseDown={() => setIsSeeking(true)}
                        onMouseUp={() => setIsSeeking(false)}
                        onTouchEnd={() => setIsSeeking(false)}
                        onTouchStart={() => setIsSeeking(true)}
                        style={{ "--range-fill": `${progressPercent}%` } as CSSProperties}
                        type="range"
                        value={shownElapsedSeconds}
                      />
                    </div>

                    <div className="mt-6 grid grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-4">
                      <button aria-label="Previous track" className="toxy-icon-button" onClick={() => previousTrack()} type="button">
                        <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                          <path d="M7 6V18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
                          <path d="M18 7L10.5 12L18 17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
                        </svg>
                      </button>

                      <button
                        aria-label="Play or pause"
                        className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_20px_var(--accent-glow)] transition-transform duration-150 hover:-translate-y-0.5"
                        onClick={togglePlayback}
                        type="button"
                      >
                        {isPlaying ? (
                          <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                            <path d="M9 6V18" stroke="currentColor" strokeLinecap="round" strokeWidth="2.1" />
                            <path d="M15 6V18" stroke="currentColor" strokeLinecap="round" strokeWidth="2.1" />
                          </svg>
                        ) : (
                          <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                            <path d="M8 6L18 12L8 18V6Z" fill="currentColor" />
                          </svg>
                        )}
                      </button>

                      <button aria-label="Next track" className="toxy-icon-button justify-self-end" onClick={() => void nextTrack()} type="button">
                        <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                          <path d="M17 6V18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
                          <path d="M6 7L13.5 12L6 17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
                        </svg>
                      </button>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
                      <div className="flex items-center gap-3">
                        <AudioWave isPlaying={isPlaying} />
                      </div>
                      <div className="toxy-companion-reader rounded-[20px] border border-[var(--line)] bg-[rgba(0,0,0,0.22)] px-3 py-3">
                        <div className="mb-2 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-[#64748B]">
                          <span>{lyricSource === "none" ? "Toxy notes" : "Lyrics live"}</span>
                          <span>{formatTrackTime(shownElapsedSeconds)}</span>
                        </div>
                        <div className="min-h-[9.4rem] space-y-2">
                          {displayedReaderRows.map((row) => (
                            <div
                              className={`grid grid-cols-[56px_minmax(0,1fr)] items-start gap-3 ${
                                row.active ? "text-[var(--text-main)]" : "text-[var(--text-muted)]"
                              }`}
                              key={row.key}
                            >
                              <span className={`text-[10px] tracking-[0.12em] ${row.active ? "text-[var(--accent)]" : "text-[#64748B]"}`}>
                                {lyricSource === "none" ? "toxy" : "lyric"}鈥?{formatTrackTime(row.time)}
                              </span>
                              <p
                                className={`m-0 min-h-[2.15rem] rounded-[12px] px-2 py-1 text-[12px] leading-6 transition-colors md:text-[13px] ${
                                  row.active
                                    ? "bg-[var(--accent-soft)] text-[var(--text-main)] shadow-[0_0_18px_rgba(0,255,170,0.08)]"
                                    : "bg-transparent opacity-72"
                                }`}
                              >
                                {row.text}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {recommendedTracks.length > 0 ? (
                      <div className="mt-4 rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(145deg,rgba(13,17,28,0.95),rgba(23,28,46,0.85))] p-3 shadow-[0_12px_34px_rgba(0,0,0,0.35)]">
                        <div className="mb-2 px-1 text-[10px] uppercase tracking-[0.2em] text-[var(--accent)]">
                          Recommended Playlist
                        </div>
                        <div className="space-y-2">
                          {recommendedTracks.slice(0, 5).map((track, index) => (
                            <button
                              className="group flex w-full items-center gap-3 rounded-[14px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2.5 py-2 text-left transition-colors hover:border-[rgba(0,255,170,0.3)] hover:bg-[rgba(0,255,170,0.05)]"
                              key={`${track.id}-${index}`}
                              onClick={() => playRecommendedTrack(track, `play ${toPlayableTrackQuery(track)}`)}
                              type="button"
                            >
                              <Image
                                alt={`${track.title} cover`}
                                className="h-10 w-10 shrink-0 rounded-[9px] object-cover"
                                height={40}
                                src={track.coverUrl || radioState.nowPlaying.coverUrl}
                                unoptimized
                                width={40}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-medium text-[var(--text-main)]">
                                  {index + 1}. {track.title}
                                </div>
                                <div className="truncate text-[11px] text-[#94A3B8]">{track.artist}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-5 flex items-center gap-3">
                      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                        <path d="M4 14H7L11 18V6L7 10H4V14Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
                      </svg>
                      <input
                        className="toxy-slider toxy-slider-volume w-full"
                        max={1}
                        min={0}
                        onChange={(event) => setVolume(Number(event.target.value))}
                        step={0.01}
                        style={{ "--range-fill": `${volumePercent}%` } as CSSProperties}
                        type="range"
                        value={volume}
                      />
                      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                        <path d="M14.5 8.5C16.17 9.14 17.3 10.75 17.3 12.6C17.3 14.45 16.17 16.06 14.5 16.7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                        <path d="M17 5.5C19.57 6.63 21.3 9.17 21.3 12.1C21.3 15.03 19.57 17.57 17 18.7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                        <path d="M4 14H7L11 18V6L7 10H4V14Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
                      </svg>
                    </div>
                  </div>
                </div>
              </motion.section>

              <motion.section className="pt-5 md:pt-7" custom={2} variants={fadeUp}>
                <div className="toxy-panel flex h-[560px] min-h-0 flex-col overflow-hidden rounded-[30px] border border-[var(--line)] shadow-[inset_0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur md:h-[620px]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-[#64748B]">LIVE TERMINAL</div>

                  <div className="flex items-center gap-3">
                    <span className={`text-[11px] uppercase tracking-[0.16em] ${llmConnected ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
                      {llmConnected ? "live" : "local"}
                    </span>
                    <button
                      aria-label="Toggle automatic voice playback"
                      className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                        isTtsEnabled
                          ? "border-[var(--line-strong)] bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "border-[var(--line)] bg-[var(--surface-3)] text-[var(--text-soft)]"
                      } ${!canUseTts ? "opacity-40" : ""}`}
                      disabled={!canUseTts}
                      onClick={() => {
                        if (!canUseTts) {
                          return;
                        }

                        const nextValue = !isTtsEnabled;
                        setIsTtsEnabled(nextValue);
                        if (!nextValue) {
                          stopCurrentSpeech();
                        }
                      }}
                      type="button"
                    >
                      voice {isTtsEnabled ? "on" : "off"}
                    </button>
                  </div>
                </div>

                <div
                  className="toxy-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
                  onScroll={handleTerminalScroll}
                  ref={terminalScrollRef}
                >
                  {terminalTurns.map((turn) => (
                    <TerminalMessage
                      canSpeak={canUseTts}
                      isSpeaking={speakingTurnId === turn.id}
                      key={turn.id}
                      onSpeak={speakTurn}
                      turn={turn}
                    />
                  ))}

                  {isBusy || isTrackSwitching || isCommentaryPending ? (
                    <article className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface-2)] text-[11px] font-semibold text-[var(--accent)] shadow-[0_0_16px_var(--accent-glow)]">
                        TX
                      </div>
                      <div className="max-w-[82%]">
                        <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Toxy</div>
                        <div className="rounded-[20px] border border-[var(--line)] bg-[rgba(0,0,0,0.26)] px-4 py-3 text-[14px] leading-7 text-[var(--text-soft)]">
                          {isGreetingPending
                            ? "Preparing a fresh opening and checking the weather"
                            : isTrackSwitching
                              ? "Switching the record right now"
                              : isCommentaryPending
                                ? "Toxy is catching up to the new track"
                                : "Retuning the booth"}
                          <span className="terminal-cursor ml-2 inline-block h-4 w-[7px] bg-[var(--accent)] align-middle" />
                        </div>
                      </div>
                    </article>
                  ) : null}

                </div>

                <form
                  className="sticky bottom-0 border-t border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-bg),var(--panel-bg))] px-4 py-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitMessage();
                  }}
                >
                  <div className="flex items-center gap-2 rounded-[16px] border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2.5">
                    <span className="text-[14px] text-[var(--text-muted)]">&gt;_</span>

                    <input
                      className="min-w-0 flex-1 border-0 border-b border-[var(--line)] bg-transparent px-0 py-1 text-[14px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                      onChange={(event) => {
                        messageRef.current = event.target.value;
                        setMessage(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void submitMessage();
                        }
                      }}
                      placeholder="Say something to the DJ..."
                      value={message}
                    />

                    {isListening ? (
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[9px] uppercase tracking-[0.18em] text-emerald-300 shadow-[0_0_18px_rgba(16,255,170,0.22)]">
                        listening
                      </span>
                    ) : null}

                    <button
                      aria-label="Voice input"
                      className={`toxy-icon-button h-9 w-9 rounded-full ${isListening ? "toxy-mic-live text-[var(--accent)]" : ""} ${
                        !isSpeechInputSupported ? "opacity-40" : ""
                      }`}
                      disabled={!isSpeechInputSupported}
                      onClick={toggleSpeechInput}
                      title={isSpeechInputSupported ? (isListening ? "Stop voice input" : "Start voice input") : "Speech input not supported"}
                      type="button"
                    >
                      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                        <path d="M12 16A4 4 0 0 0 16 12V8A4 4 0 1 0 8 8V12A4 4 0 0 0 12 16Z" stroke="currentColor" strokeWidth="1.7" />
                        <path d="M5 11.5A7 7 0 0 0 19 11.5M12 18V21M8 21H16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
                      </svg>
                    </button>

                    <button
                      aria-label="Send"
                      className="grid h-9 w-9 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_16px_var(--accent-glow)] disabled:opacity-60"
                      disabled={isBusy}
                      type="submit"
                    >
                      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                        <path d="M12 19V5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                        <path d="M6 11L12 5L18 11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                      </svg>
                    </button>
                  </div>
                </form>
              </div>
              </motion.section>
            </div>
          </div>

          <AnimatePresence>
            {isProfileDrawerOpen ? (
              <>
                <motion.button
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 z-20 bg-black/50"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  onClick={() => setIsProfileDrawerOpen(false)}
                  type="button"
                />

                <motion.aside
                  animate={{ x: 0 }}
                  className="absolute inset-y-0 right-0 z-30 flex w-[92%] max-w-[420px] flex-col border-l border-[var(--line)] bg-[var(--phone-bg)]"
                  exit={{ x: "100%" }}
                  initial={{ x: "100%" }}
                  transition={{ type: "spring", stiffness: 260, damping: 28 }}
                >
                  <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface-2)] text-[11px] font-semibold text-[var(--accent)]">
                        {avatarLabel}
                      </div>
                      <div>
                        <div className="font-['DotGothic16'] text-[18px] text-[var(--headline)] [text-shadow:0_0_10px_var(--headline-shadow)]">Your Taste</div>
                        <div className="text-[11px] text-[#64748B]">What you love to hear</div>
                      </div>
                    </div>

                    <button aria-label="Close profile drawer" className="toxy-icon-button" onClick={() => setIsProfileDrawerOpen(false)} type="button">
                      <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                        <path d="M7 7L17 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                        <path d="M17 7L7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                      </svg>
                    </button>
                  </div>

                  <div className="toxy-scroll flex-1 overflow-y-auto px-4 py-4">
                    <div className="toxy-panel rounded-[20px] border border-[var(--line)] p-4">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">Taste Profile</div>
                      <p className="mt-3 text-[13px] leading-6 text-[#64748B]">{profile.intro}</p>
                      <TasteSphere labels={tasteLabels} theme={theme} />
                    </div>

                    <div className="toxy-panel mt-3 rounded-[20px] border border-[var(--line)] p-4">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">Favorite Genres</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {profile.genres.map((genre) => (
                          <span
                            className="rounded-full border border-[var(--line)] bg-[var(--surface-3)] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#64748B]"
                            key={genre.name}
                          >
                            {genre.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="toxy-panel mt-3 rounded-[20px] border border-[var(--line)] p-4">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">Artists / Eras / Scenes</div>
                      <div className="mt-3 space-y-4 text-[13px] leading-6 text-[var(--text-soft)]">
                        <div>
                          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[#64748B]">Artists</div>
                          <div className="flex flex-wrap gap-2">
                            {profile.artists.map((artist) => (
                              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px]" key={artist}>
                                {artist}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[#64748B]">Eras</div>
                          <div className="flex flex-wrap gap-2">
                            {profile.eras.map((era) => (
                              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px]" key={era}>
                                {era}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[#64748B]">Scenes</div>
                          <div className="flex flex-wrap gap-2">
                            {profile.scenes.map((scene) => (
                              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px]" key={scene}>
                                {scene}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.aside>
              </>
            ) : null}

          </AnimatePresence>
        </motion.section>
      </div>
    </main>
  );
}

