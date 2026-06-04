import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ToolCallCard from "@/components/chat/ToolCallCard";

describe("ToolCallCard", () => {
  it("shows spinning icon for running status", () => {
    const { container } = render(
      <ToolCallCard name="generate_plan" status="running" language="en" />
    );
    const svg = container.querySelector(".animate-spin");
    expect(svg).toBeInTheDocument();
    expect(screen.getByText("Generating plan…")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows checkmark for done status", () => {
    const { container } = render(
      <ToolCallCard name="get_stand" status="done" result="Stand data loaded" language="en" />
    );
    const checkmark = container.querySelector('polyline[points="20 6 9 17 4 12"]');
    expect(checkmark).toBeInTheDocument();
    expect(screen.getByText("Fetching stand data…")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows X icon for error status", () => {
    const { container } = render(
      <ToolCallCard name="check_harvest_sustainability" status="error" result="Not sustainable" language="en" />
    );
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Checking sustainability…")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("displays result content when status is done with result", () => {
    render(
      <ToolCallCard name="plan_summary" status="done" result="Total volume: 4500 m³" language="en" />
    );
    expect(screen.getByText("Total volume: 4500 m³")).toBeInTheDocument();
  });

  it("does not display result when status is done without result", () => {
    const { container } = render(
      <ToolCallCard name="validate_plan" status="done" language="en" />
    );
    const preElements = container.querySelectorAll("pre");
    expect(preElements.length).toBe(0);
  });

  it("displays error result with warning icon", () => {
    render(
      <ToolCallCard name="add_operation" status="error" result="Failed to add operation" language="en" />
    );
    expect(screen.getByText("⚠️ Failed to add operation")).toBeInTheDocument();
  });

  it("maps unknown tool name with fallback label", () => {
    render(
      <ToolCallCard name="unknown_tool" status="running" language="en" />
    );
    expect(screen.getByText("Running unknown_tool…")).toBeInTheDocument();
  });

  it("formats all known tool names correctly in English", () => {
    const toolNames: [string, string][] = [
      ["generate_plan", "Generating plan…"],
      ["get_stand", "Fetching stand data…"],
      ["search_stands", "Searching stands…"],
      ["plan_summary", "Calculating summary…"],
      ["year_operations", "Fetching operations…"],
      ["add_operation", "Adding operation…"],
      ["remove_operation", "Removing operation…"],
      ["check_harvest_sustainability", "Checking sustainability…"],
      ["validate_plan", "Validating plan…"],
      ["create_chart", "Creating chart…"],
      ["select_stand", "Selecting stand…"],
      ["remove_chart", "Removing chart…"],
      ["clear_charts", "Clearing charts…"],
    ];

    toolNames.forEach(([name, label]) => {
      const { unmount } = render(
        <ToolCallCard name={name} status="running" language="en" />
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    });
  });

  it("formats all known tool names correctly in Finnish", () => {
    const toolNames: [string, string][] = [
      ["generate_plan", "Luodaan suunnitelmaa…"],
      ["get_stand", "Haetaan kuviotietoja…"],
      ["search_stands", "Etsitään kuvioita…"],
      ["plan_summary", "Lasketaan yhteenvetoa…"],
      ["add_operation", "Lisätään toimenpidettä…"],
      ["remove_operation", "Poistetaan toimenpidettä…"],
      ["check_harvest_sustainability", "Tarkistetaan kestävyyttä…"],
      ["validate_plan", "Vahvistetaan suunnitelmaa…"],
      ["create_chart", "Luodaan kaaviota…"],
      ["select_stand", "Valitaan kuviota…"],
      ["remove_chart", "Poistetaan kaaviota…"],
      ["clear_charts", "Tyhjennetään kaavioita…"],
    ];

    toolNames.forEach(([name, label]) => {
      const { unmount } = render(
        <ToolCallCard name={name} status="running" language="fi" />
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    });
  });

  it("shows Finnish status labels", () => {
    const { unmount } = render(
      <ToolCallCard name="get_stand" status="running" language="fi" />
    );
    expect(screen.getByText("Suoritetaan")).toBeInTheDocument();
    unmount();

    render(<ToolCallCard name="get_stand" status="done" language="fi" />);
    expect(screen.getByText("Valmis")).toBeInTheDocument();
  });

  it("shows Finnish fallback for unknown tool", () => {
    render(
      <ToolCallCard name="mystery_tool" status="running" language="fi" />
    );
    expect(screen.getByText("Suoritetaan mystery_tool…")).toBeInTheDocument();
  });
});
