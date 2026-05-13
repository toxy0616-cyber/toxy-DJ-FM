import { describe, expect, it } from 'vitest';

import { generateLlmReply } from '@/lib/providers/llm';

describe('generateLlmReply', () => {
  it('falls back to heuristic reply when api key is missing', async () => {
    const reply = await generateLlmReply([{ role: 'user', content: '下一首' }], { apiKey: '' });
    expect(reply).toContain('切到下一首');
  });

  it('falls back when remote response is invalid', async () => {
    const reply = await generateLlmReply([{ role: 'user', content: '你好' }], {
      apiKey: 'token',
      fetchImpl: async () => new Response('bad', { status: 500 }),
    });

    expect(reply).toContain('收到');
  });
});
