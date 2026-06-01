/**
 * Integration test: Hooks + MSW (P1.11 — src/lib/hooks/use-compartments.ts)
 *
 * Tests the full client → Supabase REST → state flow, with MSW as the
 * network mock. Validates that the hook correctly fetches, handles loading
 * state, and returns typed data.
 *
 * NOTE: This test requires useCompartments() to exist (P1.11).
 * Until implemented, it will be skipped. Remove .skip after P1.11.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { server } from "@/__tests__/mocks/server";
import { useCompartments } from "@/lib/hooks/use-compartments";

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useCompartments", () => {
  it("returns loading=true initially", () => {
    const { result } = renderHook(() => useCompartments("test-forest"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);
  });

  it("fetches compartments and updates state", async () => {
    const { result } = renderHook(() => useCompartments("test-forest"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0].stand_id).toBe("1");
    expect(result.current.data[1].development_class).toBe("regeneration_ready");
    expect(result.current.error).toBeNull();
  });

  it("returns empty array for unknown forest ID", async () => {
    const { result } = renderHook(() => useCompartments("nonexistent"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });

  it("does not fetch when forestId is null", () => {
    const { result } = renderHook(() => useCompartments(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
  });
});