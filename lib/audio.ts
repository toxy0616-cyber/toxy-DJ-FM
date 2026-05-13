import type { ReadStream } from "node:fs";
import { Readable } from "node:stream";

const SAMPLE_RATE = 22050;
const DURATION_SECONDS = 18;

const SOUND_MAP: Record<string, { base: number; pulse: number }> = {
  "if-bread": { base: 196, pulse: 246.94 },
  "shibuya-static": { base: 261.63, pulse: 329.63 },
  "midnight-annotate": { base: 174.61, pulse: 220 },
  "velvet-exit": { base: 146.83, pulse: 293.66 },
  "glass-morning": { base: 220, pulse: 277.18 },
  "mirror-run": { base: 130.81, pulse: 392 }
};

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function buildWaveBuffer(trackId: string) {
  const sound = SOUND_MAP[trackId] ?? SOUND_MAP["glass-morning"];
  const frameCount = SAMPLE_RATE * DURATION_SECONDS;
  const dataSize = frameCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < frameCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const swell = 0.45 + 0.25 * Math.sin(2 * Math.PI * 0.08 * time);
    const pad = Math.sin(2 * Math.PI * sound.base * time);
    const shimmer = 0.45 * Math.sin(2 * Math.PI * sound.pulse * time);
    const noise = 0.08 * Math.sin(2 * Math.PI * 31 * time);
    const sample = (pad * 0.55 + shimmer * 0.25 + noise) * swell;
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }

  return Buffer.from(buffer);
}

export function createSafeAudioStream(stream: ReadStream, signal?: AbortSignal) {
  const handleAbort = () => {
    if (!stream.destroyed) {
      stream.destroy();
    }
  };

  if (signal) {
    if (signal.aborted) {
      handleAbort();
    } else {
      signal.addEventListener("abort", handleAbort, { once: true });

      const cleanup = () => {
        signal.removeEventListener("abort", handleAbort);
      };

      stream.once("close", cleanup);
      stream.once("end", cleanup);
      stream.once("error", cleanup);
    }
  }

  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}
