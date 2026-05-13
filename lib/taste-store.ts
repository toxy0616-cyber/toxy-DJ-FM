import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { TasteSnapshot } from '@/lib/taste-source';

const DATA_DIR = join(process.cwd(), '.data');
const SNAPSHOT_FILE = join(DATA_DIR, 'taste-snapshot.json');
const MARKDOWN_FILE = join(DATA_DIR, 'taste.md');

function toMarkdown(snapshot: TasteSnapshot): string {
  const lines = ['# Taste Profile', '', `- importedAt: ${snapshot.importedAt}`, ''];

  if (snapshot.songs.length === 0) {
    lines.push('暂无导入歌曲。');
    return lines.join('\n');
  }

  lines.push('## Songs', '');
  for (const song of snapshot.songs) {
    lines.push(`- ${song.title}${song.artist ? ` - ${song.artist}` : ''} (${song.source})`);
  }

  return lines.join('\n');
}

export async function saveTasteArtifacts(snapshot: TasteSnapshot): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await Promise.all([
    writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8'),
    writeFile(MARKDOWN_FILE, toMarkdown(snapshot), 'utf8'),
  ]);
}

export async function loadTasteSnapshot(): Promise<TasteSnapshot | null> {
  try {
    const data = await readFile(SNAPSHOT_FILE, 'utf8');
    return JSON.parse(data) as TasteSnapshot;
  } catch {
    return null;
  }
}
