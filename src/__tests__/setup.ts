import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Stub ResizeObserver — not available in jsdom
global.ResizeObserver = vi.fn(function (
  this: { observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> },
  _callback: ResizeObserverCallback,
) {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
}) as unknown as typeof ResizeObserver;

// Auto-cleanup after each test
afterEach(() => {
  cleanup();
});
