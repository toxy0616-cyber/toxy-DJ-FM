export type ChatRole = "assistant" | "system" | "user";

export interface GenrePreference {
  name: string;
  weight: number;
}

export interface MoodMapping {
  mood: string;
  palette: string[];
}

export interface TasteProfile {
  tagline: string;
  intro: string;
  djVoice: string;
  genres: GenrePreference[];
  artists: string[];
  eras: string[];
  scenes: string[];
  moodMappings: MoodMapping[];
  hardNo: string[];
  radioRules: string[];
  signaturePlaylists: string[];
  rawMarkdown: string;
}

export interface TrackCandidate {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationLabel?: string;
  durationMs?: number;
  mood: string;
  energy: "low" | "medium" | "high";
  tags: string[];
  coverUrl: string;
  streamUrl: string;
  provider: "demo" | "qqmusic" | "local";
  providerTrackId: string;
  playable: boolean;
}

export interface TrackIntent {
  mood: string;
  energy: "low" | "medium" | "high";
  palette: string[];
  keywords: string[];
  avoid: string[];
  rationale: string;
}

export interface WhySelectedEntry {
  label: string;
  scoreDelta: number;
  detail: string;
}

export interface WhyRejectedEntry {
  trackId: string;
  title: string;
  artist: string;
  scoreDelta: number;
  detail: string;
}

export interface ChatTurn {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  relatedTrackId?: string;
}

export interface RadioState {
  nowPlaying: TrackCandidate;
  queue: TrackCandidate[];
  mood: string;
  onAirLine: string;
  lastReason: string;
  updatedAt: string;
  recentMoods: string[];
  recentTrackKeys: string[];
  chatHistory: ChatTurn[];
  activeSwitchToken: string | null;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ListeningRecord {
  title: string;
  artist: string;
  album?: string;
  playedAt?: string;
  durationMs?: number;
  playCount?: number;
  liked?: boolean;
  skipped?: boolean;
  releaseYear?: number;
  genres?: string[];
  tags?: string[];
  energy?: "low" | "medium" | "high";
  mood?: string;
  platform?: string;
  sourceTrackId?: string;
  sourceMid?: string;
  sourcePlaylistId?: string;
  coverUrl?: string;
}

export interface PlayableTrackSnapshot {
  provider: "qqmusic" | "local";
  providerTrackId: string;
  sourceMid?: string;
  sourcePlaylistId?: string;
  localFilePath?: string;
  mimeType?: string;
  title: string;
  artist: string;
  album: string;
  durationMs?: number;
  coverUrl?: string;
  energy: "low" | "medium" | "high";
  mood: string;
  tags: string[];
  searchableText: string;
  importedAt: string;
  playable: boolean;
}

export interface PlayableLibrarySnapshot {
  provider: "qqmusic" | "local";
  importedAt: string;
  displayName?: string;
  sourceName?: string;
  sessionCookie?: string;
  rootPath?: string;
  tracks: PlayableTrackSnapshot[];
}

export type ChatControlIntent =
  | { type: "none" }
  | { type: "next" }
  | { type: "queue_index"; queueIndex: number }
  | { type: "track_query"; query: string };

export type TrackSelectionStatus = "picked" | "candidate_required" | "fallback_demo";

export interface TasteOverlay {
  name: string;
  weight: number;
  sourceName?: string;
  listeningHistory: ListeningRecord[];
}

export interface TasteImportPayload {
  platform: string;
  displayName?: string;
  sourceName?: string;
  listeningHistory: ListeningRecord[];
  overlays?: TasteOverlay[];
  favorites?: ListeningRecord[];
  dislikes?: string[];
}

export interface TasteSourceSnapshot {
  platform: string;
  displayName?: string;
  sourceName?: string;
  importedAt: string;
  recordCount: number;
  likedCount: number;
  skippedCount: number;
  topTracks: string[];
  topArtists: string[];
  topGenres: string[];
  topTags: string[];
  moodHints: string[];
}

export interface GeneratedTasteArtifacts {
  profile: TasteProfile;
  markdown: string;
  snapshot: TasteSourceSnapshot;
}

export interface DailyPlaylistEntry {
  slot: string;
  mood: string;
  summary: string;
  track: TrackCandidate;
}

export interface ChatResponsePayload {
  assistantTurn: ChatTurn;
  mood: string;
  reason: string;
  radioState: RadioState;
  candidates: TrackCandidate[];
  controlIntent: ChatControlIntent;
  selectionStatus: TrackSelectionStatus;
  candidateTracks?: TrackCandidate[];
  weatherSummary?: string;
  why_selected?: WhySelectedEntry[];
  why_rejected?: WhyRejectedEntry[];
}

export interface GreetingResponsePayload {
  assistantTurn: ChatTurn;
  radioState: RadioState;
  llmConnected: boolean;
  weatherSummary?: string;
}

export interface RadioSelectPayload {
  radioState: RadioState;
  controlIntent: ChatControlIntent;
  selectionStatus: TrackSelectionStatus;
  candidateTracks?: TrackCandidate[];
  assistantTurn?: ChatTurn;
  switchToken?: string | null;
  why_selected?: WhySelectedEntry[];
  why_rejected?: WhyRejectedEntry[];
}

export interface RadioCommentaryPayload {
  assistantTurn?: ChatTurn;
  radioState: RadioState;
  controlIntent: ChatControlIntent;
  selectionStatus: TrackSelectionStatus;
  skipped: boolean;
  switchToken?: string | null;
  why_selected?: WhySelectedEntry[];
  why_rejected?: WhyRejectedEntry[];
}
