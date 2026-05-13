type ChatInput = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type FetchLike = typeof fetch;

function fallbackReply(messages: ChatInput[]): string {
  const latestUser = [...messages].reverse().find((msg) => msg.role === 'user')?.content?.trim() ?? '';
  if (!latestUser) {
    return '我在，随时可以聊音乐。';
  }
  if (latestUser.includes('下一首') || latestUser.includes('切歌')) {
    return '收到，马上切到下一首。';
  }
  if (latestUser.includes('点歌')) {
    return '好的，我会尽量安排你点的歌。';
  }

  return `收到：${latestUser}，我会继续按你的口味编排。`;
}

export async function generateLlmReply(
  messages: ChatInput[],
  options?: { apiKey?: string; fetchImpl?: FetchLike },
): Promise<string> {
  const apiKey = options?.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const fetchImpl = options?.fetchImpl ?? fetch;

  if (!apiKey) {
    return fallbackReply(messages);
  }

  try {
    const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
      }),
    });

    if (!response.ok) {
      return fallbackReply(messages);
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.trim();
    return content || fallbackReply(messages);
  } catch {
    return fallbackReply(messages);
  }
}
