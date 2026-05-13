import { NextResponse } from "next/server";

import { ensureRadioState } from "@/lib/radio-state";
import { readTasteProfile } from "@/lib/taste";

export async function GET() {
  const profile = await readTasteProfile();
  const radioState = await ensureRadioState(profile);

  return NextResponse.json({
    radioState
  });
}

