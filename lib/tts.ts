interface TtsConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  voice: string;
  instructions: string;
}

export interface SynthesizedSpeech {
  audioBuffer: ArrayBuffer;
  mimeType: string;
}

const OPENAI_TTS_BASE_URL = "https://api.openai.com/v1";
const OPENAI_TTS_DEFAULT_MODEL = "gpt-4o-mini-tts";
const OPENAI_TTS_DEFAULT_VOICE = "coral";
const OPENAI_TTS_DEFAULT_INSTRUCTIONS =
  "Speak like Toxy, a warm late-night AI radio host. Keep the pacing clear, intimate, and natural, and deliver every line in English.";

export function resolveTtsConfigFromEnv(env = process.env): TtsConfig {
  return {
    apiKey: env.OPENAI_API_KEY?.trim(),
    baseUrl: env.OPENAI_TTS_BASE_URL?.trim() || OPENAI_TTS_BASE_URL,
    model: env.OPENAI_TTS_MODEL?.trim() || OPENAI_TTS_DEFAULT_MODEL,
    voice: env.OPENAI_TTS_VOICE?.trim() || OPENAI_TTS_DEFAULT_VOICE,
    instructions: env.OPENAI_TTS_INSTRUCTIONS?.trim() || OPENAI_TTS_DEFAULT_INSTRUCTIONS
  };
}

export function hasServerTtsConfig(env = process.env) {
  const config = resolveTtsConfigFromEnv(env);
  return Boolean(config.apiKey && config.baseUrl && config.model && config.voice);
}

export async function synthesizeSpeech(text: string): Promise<SynthesizedSpeech | null> {
  const config = resolveTtsConfigFromEnv();
  if (!config.apiKey) {
    return null;
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      voice: config.voice,
      input: text,
      instructions: config.instructions,
      response_format: "mp3"
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`TTS request failed with ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return {
    audioBuffer: await response.arrayBuffer(),
    mimeType: response.headers.get("content-type") || "audio/mpeg"
  };
}
