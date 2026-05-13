import { NextResponse } from 'next/server';

import { normalizeTasteSource } from '@/lib/taste-source';
import { saveTasteArtifacts } from '@/lib/taste-store';

export async function POST(request: Request) {
  const body = await request.json();
  const snapshot = normalizeTasteSource(body);
  await saveTasteArtifacts(snapshot);

  return NextResponse.json({ ok: true, count: snapshot.songs.length, importedAt: snapshot.importedAt });
}
