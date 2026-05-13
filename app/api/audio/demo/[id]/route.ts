import { buildWaveBuffer } from "@/lib/audio";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const buffer = buildWaveBuffer(id);

  return new Response(buffer, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "public, max-age=3600"
    }
  });
}

