import type { TrackCandidate } from "@/lib/types";
import { escapeSvg } from "@/lib/utils";

function buildCover(title: string, accent: string, subAccent: string) {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#090a10" />
        <stop offset="100%" stop-color="#111824" />
      </linearGradient>
    </defs>
    <rect width="360" height="360" rx="28" fill="url(#g)" />
    <g stroke="${accent}" stroke-opacity="0.32">
      <path d="M40 70 H320" />
      <path d="M40 120 H320" />
      <path d="M40 170 H320" />
      <path d="M40 220 H320" />
      <path d="M40 270 H320" />
      <path d="M70 40 V320" />
      <path d="M120 40 V320" />
      <path d="M170 40 V320" />
      <path d="M220 40 V320" />
      <path d="M270 40 V320" />
    </g>
    <circle cx="78" cy="74" r="12" fill="${subAccent}" />
    <text x="40" y="140" fill="#f5f7fb" font-family="Consolas, monospace" font-size="36">${escapeSvg(title)}</text>
    <text x="40" y="192" fill="${accent}" font-family="Consolas, monospace" font-size="18">TOXY FM</text>
    <rect x="40" y="230" width="280" height="42" rx="21" fill="none" stroke="${accent}" stroke-width="2" />
    <text x="58" y="257" fill="#f5f7fb" font-family="Consolas, monospace" font-size="18">ON AIR</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildTrack(
  id: string,
  title: string,
  artist: string,
  album: string,
  mood: string,
  energy: TrackCandidate["energy"],
  durationLabel: string,
  tags: string[],
  accent: string,
  subAccent: string
): TrackCandidate {
  return {
    id,
    title,
    artist,
    album,
    mood,
    energy,
    durationLabel,
    durationMs: undefined,
    tags,
    coverUrl: buildCover(title, accent, subAccent),
    streamUrl: `/api/audio/demo/${id}`,
    provider: "demo",
    providerTrackId: id,
    playable: true
  };
}

export const demoTracks: TrackCandidate[] = [
  buildTrack(
    "if-bread",
    "If",
    "Bread",
    "Mellow Gold Aircheck",
    "rainy",
    "low",
    "2:38",
    ["soft-rock", "rainy", "gentle", "70s"],
    "#58f5d2",
    "#9df7e9"
  ),
  buildTrack(
    "shibuya-static",
    "Shibuya Static",
    "Lamp Signal",
    "Platform Reverie",
    "romantic",
    "low",
    "3:11",
    ["shibuya-kei", "city-pop", "night", "dreamy"],
    "#ffd36e",
    "#fef0bd"
  ),
  buildTrack(
    "midnight-annotate",
    "Midnight Annotate",
    "Desk Ghost",
    "Window Compiler",
    "locked-in",
    "medium",
    "2:52",
    ["jazz-hiphop", "instrumental", "focus", "vinyl"],
    "#7affc7",
    "#ccffe9"
  ),
  buildTrack(
    "velvet-exit",
    "Velvet Exit",
    "Neon Birds",
    "Posture & Pulse",
    "defiant",
    "medium",
    "3:28",
    ["post-punk", "night", "drums", "tension"],
    "#ff7f7f",
    "#ffd5d5"
  ),
  buildTrack(
    "glass-morning",
    "Glass Morning",
    "Nami Sato",
    "After Rain Notes",
    "drained",
    "low",
    "4:02",
    ["neo-classical", "piano", "ambient", "recovery"],
    "#9eafff",
    "#d9e0ff"
  ),
  buildTrack(
    "mirror-run",
    "Mirror Run",
    "Club Null",
    "Algorithm Poison",
    "defiant",
    "high",
    "3:06",
    ["festival", "edm", "hype", "drops"],
    "#ff5fa2",
    "#ffc2db"
  )
];
