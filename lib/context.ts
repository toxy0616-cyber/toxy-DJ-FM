import type { RadioState } from "@/lib/types";

export interface RuntimeContext {
  dayPart: "late-night" | "morning" | "afternoon" | "evening";
  dayName: string;
  localTime: string;
  currentMood: string;
  recentMessages: string[];
  weatherStatus: "pending";
  scheduleStatus: "pending";
}

function getDayPart(hours: number): RuntimeContext["dayPart"] {
  if (hours < 6) {
    return "late-night";
  }

  if (hours < 12) {
    return "morning";
  }

  if (hours < 18) {
    return "afternoon";
  }

  return "evening";
}

export function buildRuntimeContext(radioState: RadioState): RuntimeContext {
  const now = new Date();
  const hours = now.getHours();

  return {
    dayPart: getDayPart(hours),
    dayName: now.toLocaleDateString("en-US", { weekday: "long" }),
    localTime: now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }),
    currentMood: radioState.mood,
    recentMessages: radioState.chatHistory.slice(-4).map((item) => item.text),
    weatherStatus: "pending",
    scheduleStatus: "pending"
  };
}
