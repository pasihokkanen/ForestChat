import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ToolCallCard from "@/components/chat/ToolCallCard";

describe("ToolCallCard", () => {
  it("shows spinning icon for running status", () => {
    const { container } = render(
      <ToolCallCard name="generate_plan" status="running" />
    );
    const svg = container.querySelector(".animate-spin");
    expect(svg).toBeInTheDocument();
    expect(screen.getByText("Generating plan...")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows checkmark for done status", () => {
    const { container } = render(
      <ToolCallCard name="get_stand" status="done" result="Stand data loaded" />
    );
    const checkmark = container.querySelector('polyline[points="20 6 9 17 4 12"]');
    expect(checkmark).toBeInTheDocument();
    expect(screen.getByText("Fetching stand data...")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows X icon for error status", () => {
    const { container } = render(
      <ToolCallCard name="check_harvest_sustainability" status="error" result="Not sustainable" />
    );
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Checking sustainability...")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("displays result content when status is done with result", () => {
    render(
      <ToolCallCard name="plan_summary" status="done" result="Total volume: 4500 m³" />
    );
    expect(screen.getByText("Total volume: 4500 m³")).toBeInTheDocument();
  });

  it("does not display result when status is done without result", () => {
    const { container } = render(
      <ToolCallCard name="validate_plan" status="done" />
    );
    const preElements = container.querySelectorAll("pre");
    expect(preElements.length).toBe(0);
  });

  it("displays error result with warning icon", () => {
    render(
      <ToolCallCard name="add_operation" status="error" result="Failed to add operation" />
    );
    expect(screen.getByText("⚠️ Failed to add operation")).toBeInTheDocument();
  });

  it("maps unknown tool name with fallback label", () => {
    render(
      <ToolCallCard name="unknown_tool" status="running" />
    );
    expect(screen.getByText("Running unknown_tool...")).toBeInTheDocument();
  });

  it("formats all known tool names correctly", () => {
    const toolNames = [
      ["generate_plan", "Generating plan..."],
      ["get_stand", "Fetching stand data..."],
      ["search_stands", "Searching stands..."],
      ["plan_summary", "Calculating summary..."],
      ["year_operations", "Fetching operations..."],
      ["add_operation", "Adding operation..."],
      ["remove_operation", "Removing operation..."],
      ["check_harvest_sustainability", "Checking sustainability..."],
      ["validate_plan", "Validating plan..."],
    ];

    toolNames.forEach(([name, label]) => {
      const { unmount } = render(
        <ToolCallCard name={name} status="running" />
      );
      expect(screen.getByText(label as string)).toBeInTheDocument();
      unmount();
    });
  });
});