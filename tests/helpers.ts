import { expect } from "vitest";

export function expectDefined<T>(
  value: T | null | undefined,
  message = "Expected value to be defined"
): T {
  expect(value, message).toBeDefined();
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

export function expectFirst<T>(
  values: readonly T[],
  message = "Expected at least one item"
): T {
  expect(values.length, message).toBeGreaterThan(0);
  return expectDefined(values[0], message);
}
