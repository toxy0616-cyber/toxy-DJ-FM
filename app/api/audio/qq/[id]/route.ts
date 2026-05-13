import { NextResponse } from "next/server";

import { resolveQqStreamUrl } from "@/lib/qqmusic-stream";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const stream = await resolveQqStreamUrl(id);
    const upstream = await fetch(stream.url, {
      headers: {
        Cookie: stream.sessionCookie,
        Referer: "https://y.qq.com/"
      }
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `QQ audio upstream failed with ${upstream.status}.` },
        { status: upstream.status || 502 }
      );
    }

    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
      "Cache-Control": "no-store"
    });
    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(upstream.body, {
      status: 200,
      headers
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resolve QQ audio stream." },
      { status: 400 }
    );
  }
}
