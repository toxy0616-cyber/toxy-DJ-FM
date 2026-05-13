import { NextResponse } from 'next/server';

import { normalizeTasteSource } from '@/lib/taste-source';
import { saveTasteArtifacts } from '@/lib/taste-store';

export async function POST(request: Request) {
  const body = (await request.json()) as { songs?: Array<{ title?: string; artist?: string }> };
  const snapshot = normalizeTasteSource({ source: 'qqmusic', songs: body.songs ?? [] });
  await saveTasteArtifacts(snapshot);

  return NextResponse.json({ ok: true, source: 'qqmusic', count: snapshot.songs.length });
}
