import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { appendEvent, queryEvents, queryRecentEvents, generateEventId } from "../src/core/timeline.js";
import type { TimelineEvent } from "../src/types/index.js";
import { expectFirst } from "./helpers.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-test-"));
  await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
    actor: "agent",
    tool: "safe_write",
    operation: "write",
    path: "test.txt",
    beforeHash: null,
    afterHash: "abc123",
    risk: "low",
    committed: true,
    ...overrides,
  };
}

describe("timeline", () => {
  it("event can be appended and queried", async () => {
    const event = makeEvent();
    await appendEvent(tmpDir, event);

    const events = await queryEvents(tmpDir, {});
    expect(events.length).toBe(1);
    expect(expectFirst(events).eventId).toBe(event.eventId);
  });

  it("since filter works", async () => {
    const oldEvent = makeEvent({
      timestamp: new Date(Date.now() - 7200000).toISOString(),
    });
    const newEvent = makeEvent({
      timestamp: new Date().toISOString(),
    });

    await appendEvent(tmpDir, oldEvent);
    await appendEvent(tmpDir, newEvent);

    const events = await queryEvents(tmpDir, {
      since: new Date(Date.now() - 3600000),
    });
    expect(events.length).toBe(1);
    expect(expectFirst(events).eventId).toBe(newEvent.eventId);
  });

  it("until filter works", async () => {
    const oldEvent = makeEvent({
      timestamp: new Date(Date.now() - 7200000).toISOString(),
    });
    const newEvent = makeEvent({
      timestamp: new Date().toISOString(),
    });

    await appendEvent(tmpDir, oldEvent);
    await appendEvent(tmpDir, newEvent);

    const events = await queryEvents(tmpDir, {
      until: new Date(Date.now() - 3600000),
    });
    expect(events.length).toBe(1);
    expect(expectFirst(events).eventId).toBe(oldEvent.eventId);
  });

  it("path filter works", async () => {
    await appendEvent(tmpDir, makeEvent({ path: "a.txt" }));
    await appendEvent(tmpDir, makeEvent({ path: "b.txt" }));

    const events = await queryEvents(tmpDir, { path: "a.txt" });
    expect(events.length).toBe(1);
    expect(expectFirst(events).path).toBe("a.txt");
  });

  it("limit works", async () => {
    await appendEvent(tmpDir, makeEvent());
    await appendEvent(tmpDir, makeEvent());
    await appendEvent(tmpDir, makeEvent());

    const events = await queryEvents(tmpDir, { limit: 2 });
    expect(events.length).toBe(2);
  });

  it("invalid JSONL line is skipped", async () => {
    const filePath = path.join(tmpDir, ".safefs", "timeline", "events.jsonl");
    const validEvent = makeEvent();
    await fs.appendFile(filePath, "not valid json\n", "utf-8");
    await fs.appendFile(filePath, `${JSON.stringify(validEvent)}\n`, "utf-8");

    const events = await queryEvents(tmpDir, {});
    expect(events.length).toBe(1);
    expect(expectFirst(events).eventId).toBe(validEvent.eventId);
  });

  it("query coalesces pending and committed events by eventId", async () => {
    const eventId = generateEventId();
    await appendEvent(
      tmpDir,
      makeEvent({
        eventId,
        committed: false,
        status: "pending",
        afterHash: "pending-hash",
      })
    );
    await appendEvent(
      tmpDir,
      makeEvent({
        eventId,
        committed: true,
        status: "committed",
        afterHash: "committed-hash",
      })
    );

    const events = await queryEvents(tmpDir, {});
    expect(events.length).toBe(1);
    const event = expectFirst(events);
    expect(event.eventId).toBe(eventId);
    expect(event.status).toBe("committed");
    expect(event.afterHash).toBe("committed-hash");
  });

  it("query returns failed as the latest event status", async () => {
    const eventId = generateEventId();
    await appendEvent(
      tmpDir,
      makeEvent({
        eventId,
        committed: false,
        status: "pending",
      })
    );
    await appendEvent(
      tmpDir,
      makeEvent({
        eventId,
        committed: false,
        status: "failed",
        error: "write failed",
      })
    );

    const events = await queryEvents(tmpDir, {});
    expect(events.length).toBe(1);
    const event = expectFirst(events);
    expect(event.status).toBe("failed");
    expect(event.error).toBe("write failed");
  });

  it("returns empty array if timeline file does not exist", async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-empty-"));
    const events = await queryEvents(freshDir, {});
    expect(events).toEqual([]);
    await fs.rm(freshDir, { recursive: true, force: true });
  });

  it("queryRecentEvents reads beyond the last tail chunk when needed", async () => {
    const target = makeEvent({
      path: "target.txt",
      timestamp: new Date().toISOString(),
    });
    await appendEvent(tmpDir, target);

    for (let i = 0; i < 260; i++) {
      await appendEvent(
        tmpDir,
        makeEvent({
          path: `padding-${i}.txt`,
          reason: "x".repeat(600),
          timestamp: new Date().toISOString(),
        })
      );
    }

    const events = await queryRecentEvents(tmpDir, {
      since: new Date(Date.now() - 60_000),
      path: "target.txt",
    });
    expect(events.some((event) => event.eventId === target.eventId)).toBe(true);
  });
});
