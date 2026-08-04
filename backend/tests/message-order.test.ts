import { describe, expect, it } from "vitest";

import {
  orderRecentContextMessages,
  type RecentContextMessage,
} from "../src/pipeline/message-order.js";

const sharedTime = new Date("2026-08-04T01:00:00.000Z");
const turnId = "2cafb281-a2b2-41c4-b6ee-b85fba970dbe";

function message(
  id: string,
  role: RecentContextMessage["role"],
  content: string,
  partIndex: number | null,
): RecentContextMessage {
  return { id, turnId, role, content, createdAt: sharedTime, partIndex };
}

describe("Thought recent-history ordering", () => {
  it("keeps a user message before same-time assistant bubbles", () => {
    const records = [
      message("00000000-0000-4000-8000-000000000003", "assistant", "third", 1),
      message("00000000-0000-4000-8000-000000000001", "user", "first", null),
      message("00000000-0000-4000-8000-000000000002", "assistant", "second", 0),
    ];

    expect(orderRecentContextMessages(records).map((record) => record.content))
      .toEqual(["first", "second", "third"]);
  });

  it("uses partIndex rather than UUID order for assistant bubbles", () => {
    const records = [
      message("00000000-0000-4000-8000-000000000001", "assistant", "second", 1),
      message("00000000-0000-4000-8000-000000000002", "assistant", "first", 0),
    ];

    expect(orderRecentContextMessages(records).map((record) => record.content))
      .toEqual(["first", "second"]);
  });
});
