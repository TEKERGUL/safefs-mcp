import { describe, it, expect } from "vitest";
import { parseTimeInput } from "../src/core/timeParser.js";

describe("timeParser", () => {
  it("15m works", () => {
    const result = parseTimeInput("15m");
    const expected = Date.now() - 15 * 60 * 1000;
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(100);
  });

  it("1h works", () => {
    const result = parseTimeInput("1h");
    const expected = Date.now() - 60 * 60 * 1000;
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(100);
  });

  it("3h works", () => {
    const result = parseTimeInput("3h");
    const expected = Date.now() - 3 * 60 * 60 * 1000;
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(100);
  });

  it("1d works", () => {
    const result = parseTimeInput("1d");
    const expected = Date.now() - 24 * 60 * 60 * 1000;
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(100);
  });

  it("7d works", () => {
    const result = parseTimeInput("7d");
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(100);
  });

  it("ISO timestamp works", () => {
    const iso = "2026-06-09T09:00:00Z";
    const result = parseTimeInput(iso);
    expect(result.getTime()).toBe(new Date(iso).getTime());
  });

  it("rejects 'yesterday'", () => {
    expect(() => parseTimeInput("yesterday")).toThrow("Invalid time format");
  });

  it("rejects 'soon'", () => {
    expect(() => parseTimeInput("soon")).toThrow("Invalid time format");
  });

  it("rejects 'one hour'", () => {
    expect(() => parseTimeInput("one hour")).toThrow("Invalid time format");
  });

  it("rejects '1 hour' (with space)", () => {
    expect(() => parseTimeInput("1 hour")).toThrow("Invalid time format");
  });

  it("rejects 'abc'", () => {
    expect(() => parseTimeInput("abc")).toThrow("Invalid time format");
  });

  it("rejects empty string", () => {
    expect(() => parseTimeInput("")).toThrow("Invalid time format");
  });
});
