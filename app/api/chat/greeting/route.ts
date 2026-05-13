import { NextResponse } from "next/server";

import { createGreetingAction } from "@/lib/orchestrator";

export async function GET() {
  return NextResponse.json({
    message: "POST to this endpoint to create and persist Toxy's opening greeting."
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    reset?: boolean;
    latitude?: number;
    longitude?: number;
  };

  const payload = await createGreetingAction({
    reset: body.reset === true,
    latitude: typeof body.latitude === "number" ? body.latitude : undefined,
    longitude: typeof body.longitude === "number" ? body.longitude : undefined
  });

  return NextResponse.json(payload);
}
