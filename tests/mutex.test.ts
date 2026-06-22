import { describe, it, expect } from "vitest";
import { Mutex, PathMutexes } from "../src/core/mutex.js";

describe("Mutex", () => {
  it("acquires and releases", async () => {
    const mutex = new Mutex();
    const release = await mutex.acquire();
    expect(mutex.isLocked).toBe(true);
    release();
    expect(mutex.isLocked).toBe(false);
  });

  it("queues waiters and processes in order", async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    const release1 = await mutex.acquire();
    const p2 = mutex.acquire().then((r) => {
      order.push(2);
      return r;
    });
    const p3 = mutex.acquire().then((r) => {
      order.push(3);
      return r;
    });

    release1();
    const release2 = await p2;
    release2();
    const release3 = await p3;
    release3();

    expect(order).toEqual([2, 3]);
  });

  it("rejects on timeout", async () => {
    const mutex = new Mutex();
    await mutex.acquire(); // hold the lock

    await expect(mutex.acquire(50)).rejects.toThrow("timeout");
  });

  it("does not reject before timeout", async () => {
    const mutex = new Mutex();
    const release = await mutex.acquire();

    setTimeout(() => release(), 20);
    const release2 = await mutex.acquire(200);
    release2();
    expect(mutex.isLocked).toBe(false);
  });

  it("timeout removes entry from queue", async () => {
    const mutex = new Mutex();
    const release = await mutex.acquire();

    await expect(mutex.acquire(10)).rejects.toThrow("timeout");

    release();
    // Should be unlocked after timeout entry was cleaned up
    expect(mutex.isLocked).toBe(false);
  });
});

describe("PathMutexes", () => {
  it("creates mutex per path", async () => {
    const pm = new PathMutexes();
    const releaseA = await pm.acquire("a.txt");
    const releaseB = await pm.acquire("b.txt");

    releaseA();
    releaseB();
  });

  it("same path queues correctly", async () => {
    const pm = new PathMutexes();
    const values: number[] = [];

    const release1 = await pm.acquire("file.txt");
    const p2 = pm.acquire("file.txt").then((r) => {
      values.push(2);
      return r;
    });

    release1();
    const release2 = await p2;
    release2();
    expect(values).toEqual([2]);
  });

  it("applies default timeout", async () => {
    const pm = new PathMutexes();
    await pm.acquire("locked.txt"); // hold without releasing

    // The default is 30s, so we test with explicit short timeout
    await expect(pm.acquire("locked.txt", 50)).rejects.toThrow("timeout");
  });
});
