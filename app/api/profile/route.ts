import { NextResponse } from "next/server";

import { readTasteProfile } from "@/lib/taste";
import { readTasteSourceSnapshot } from "@/lib/taste-store";

export async function GET() {
  const profile = await readTasteProfile();
  const snapshot = await readTasteSourceSnapshot();
  return NextResponse.json({ profile, snapshot });
}
