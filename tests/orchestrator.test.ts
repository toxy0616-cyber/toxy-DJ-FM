import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

let baseDir = '';

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'toxy-dj-fm-'));
  process.chdir(baseDir);
  vi.resetModules();
});

describe('orchestrator', () => {
  it('supports next-song intent', async () => {
    const { getRadioState, orchestrateUserMessage } = await import('@/lib/orchestrator');
    const initial = await getRadioState();
    const next = await orchestrateUserMessage('下一首');

    expect(initial.nowPlaying?.id).not.toBe(next.nowPlaying?.id);
  });

  it('supports request intent', async () => {
    const { orchestrateUserMessage } = await import('@/lib/orchestrator');
    const next = await orchestrateUserMessage('点歌 Neon Rain');

    expect(next.nowPlaying?.title).toBe('Neon Rain');
  });
});
