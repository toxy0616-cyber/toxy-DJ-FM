'use client';

import type { RadioState } from '@/lib/orchestrator';

export function ToxyRadio({ initialState }: { initialState: RadioState }) {
  return (
    <main>
      <h1>Toxy DJ FM</h1>
      <section>
        <h2>播放器</h2>
        <p>当前歌曲：{initialState.nowPlaying?.title ?? '暂无歌曲'}</p>
      </section>
      <section>
        <h2>聊天</h2>
        <ul>
          {initialState.chatHistory.map((msg) => (
            <li key={msg.id}>
              <strong>{msg.role}:</strong> {msg.content}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
