export type TasteSong = {
  title: string;
  artist?: string;
  source: 'local' | 'qqmusic';
};

export type TasteSnapshot = {
  importedAt: string;
  songs: TasteSong[];
};

export function normalizeTasteSource(input: unknown): TasteSnapshot {
  const payload = (input ?? {}) as {
    songs?: Array<Partial<TasteSong>>;
    source?: 'local' | 'qqmusic';
  };

  const source = payload.source ?? 'local';
  const songs = (payload.songs ?? [])
    .filter((song): song is Partial<TasteSong> & { title: string } => typeof song?.title === 'string' && song.title.length > 0)
    .map((song) => ({
      title: song.title,
      artist: typeof song.artist === 'string' ? song.artist : undefined,
      source,
    }));

  return {
    importedAt: new Date().toISOString(),
    songs,
  };
}
