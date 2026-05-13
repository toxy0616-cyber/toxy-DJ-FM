import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { generateLlmReply } from '@/lib/providers/llm';

export type Song = {
  id: string;
  title: string;
  artist?: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type RadioState = {
  nowPlaying: Song | null;
  queue: Song[];
  chatHistory: ChatMessage[];
};

type Intent =
  | { type: 'next' }
  | { type: 'request'; title: string }
  | { type: 'chat' };

const DATA_DIR = join(process.cwd(), '.data');
const RADIO_STATE_FILE = join(DATA_DIR, 'radio-state.json');
const PLAYABLE_LIBRARY_FILE = join(DATA_DIR, 'playable-library.json');

const DEFAULT_LIBRARY: Song[] = [
  { id: '1', title: 'Midnight Drive', artist: 'Toxy FM' },
  { id: '2', title: 'Neon Rain', artist: 'Toxy FM' },
];

const DEFAULT_STATE: RadioState = {
  nowPlaying: DEFAULT_LIBRARY[0],
  queue: DEFAULT_LIBRARY.slice(1),
  chatHistory: [],
};

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, 'utf8');
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDataDir();
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

function detectIntent(message: string): Intent {
  const normalized = message.trim();
  if (normalized.includes('下一首') || normalized.includes('切歌')) {
    return { type: 'next' };
  }
  const requestMatch = normalized.match(/点歌[:：\s]*(.+)$/);
  if (requestMatch?.[1]) {
    return { type: 'request', title: requestMatch[1].trim() };
  }
  return { type: 'chat' };
}

function rotateNext(state: RadioState, library: Song[]): RadioState {
  const currentIndex = library.findIndex((song) => song.id === state.nowPlaying?.id);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % library.length : 0;
  const nowPlaying = library[nextIndex] ?? null;
  const queue = nowPlaying ? library.filter((song) => song.id !== nowPlaying.id) : [];
  return { ...state, nowPlaying, queue };
}

function applyRequest(state: RadioState, library: Song[], title: string): RadioState {
  const picked = library.find((song) => song.title.toLowerCase() === title.toLowerCase());
  if (!picked) {
    return state;
  }
  const queue = [picked, ...library.filter((song) => song.id !== picked.id)];
  return { ...state, nowPlaying: picked, queue: queue.slice(1) };
}

export async function getPlayableLibrary(): Promise<Song[]> {
  const existing = await readJsonFile<Song[]>(PLAYABLE_LIBRARY_FILE);
  if (existing && existing.length > 0) {
    return existing;
  }

  await writeJsonFile(PLAYABLE_LIBRARY_FILE, DEFAULT_LIBRARY);
  return DEFAULT_LIBRARY;
}

export async function getRadioState(): Promise<RadioState> {
  const existing = await readJsonFile<RadioState>(RADIO_STATE_FILE);
  if (existing) {
    return existing;
  }

  await writeJsonFile(RADIO_STATE_FILE, DEFAULT_STATE);
  return DEFAULT_STATE;
}

export async function orchestrateUserMessage(message: string): Promise<RadioState> {
  const [state, library] = await Promise.all([getRadioState(), getPlayableLibrary()]);
  const intent = detectIntent(message);

  let nextState = state;
  if (intent.type === 'next') {
    nextState = rotateNext(state, library);
  } else if (intent.type === 'request') {
    nextState = applyRequest(state, library, intent.title);
  }

  const reply = await generateLlmReply([
    ...nextState.chatHistory.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user' as const, content: message },
  ]);

  nextState = {
    ...nextState,
    chatHistory: [...nextState.chatHistory, { role: 'user', content: message }, { role: 'assistant', content: reply }],
  };

  await writeJsonFile(RADIO_STATE_FILE, nextState);
  return nextState;
}
