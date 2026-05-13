import { describe, expect, test } from "vitest";

import { parseControlIntent } from "@/lib/control-intent";

describe("parseControlIntent", () => {
  test("parses next track commands in Chinese", () => {
    expect(parseControlIntent("\u4e0b\u4e00\u9996")).toEqual({ type: "next" });
  });

  test("parses queue index commands", () => {
    expect(parseControlIntent("\u5207\u5230\u7b2c2\u9996")).toEqual({ type: "queue_index", queueIndex: 2 });
  });

  test("parses named track requests", () => {
    expect(parseControlIntent("\u64ad\u653e\u5468\u6770\u4f26\u7684\u6674\u5929")).toEqual({
      type: "track_query",
      query: "\u5468\u6770\u4f26\u7684\u6674\u5929"
    });
  });

  test("parses natural Chinese request phrasing", () => {
    expect(parseControlIntent("\u6211\u60f3\u542c\u6674\u5929")).toEqual({
      type: "track_query",
      query: "\u6674\u5929"
    });
  });

  test("parses artist-style request phrasing", () => {
    expect(parseControlIntent("\u7ed9\u6211\u653e\u4e00\u9996 kanye \u7684\u6b4c")).toEqual({
      type: "track_query",
      query: "\u4e00\u9996 kanye \u7684\u6b4c"
    });
  });

  test("parses english listen commands", () => {
    expect(parseControlIntent("listen to Numb")).toEqual({ type: "track_query", query: "Numb" });
  });

  test("ignores regular conversation", () => {
    expect(parseControlIntent("\u6211\u4eca\u5929\u6709\u70b9\u7d2f")).toEqual({ type: "none" });
  });
});
