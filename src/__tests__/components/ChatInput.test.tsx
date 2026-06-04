import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatInput from "@/components/chat/ChatInput";

describe("ChatInput", () => {
  const mockOnSend = vi.fn();

  beforeEach(() => {
    mockOnSend.mockClear();
  });

  it("renders textarea and send button", () => {
    render(<ChatInput onSend={mockOnSend} disabled={false} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Send message")).toBeInTheDocument();
  });

  it("sends message on Enter", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} disabled={false} />);

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Hello");
    await user.keyboard("{Enter}");

    expect(mockOnSend).toHaveBeenCalledWith("Hello");
  });

  it("does not send empty message", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} disabled={false} />);

    await user.keyboard("{Enter}");
    expect(mockOnSend).not.toHaveBeenCalled();
  });

  it("inserts newline on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} disabled={false} />);

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "line1");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(textarea, "line2");

    expect(mockOnSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("line1\nline2");
  });

  it("disables send button when disabled prop is true", () => {
    render(<ChatInput onSend={mockOnSend} disabled={true} />);
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  it("disables send button when input is empty", () => {
    render(<ChatInput onSend={mockOnSend} disabled={false} />);
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  it("enables send button when input has text", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} disabled={false} />);

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "test");

    expect(screen.getByLabelText("Send message")).toBeEnabled();
  });

  it("clears input after sending", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} disabled={false} />);

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Clear me");
    await user.keyboard("{Enter}");

    expect(textarea).toHaveValue("");
  });

  it("disables textarea when disabled prop is true", () => {
    render(<ChatInput onSend={mockOnSend} disabled={true} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("has data-chat-input attribute on textarea", () => {
    render(<ChatInput onSend={mockOnSend} disabled={false} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("data-chat-input");
  });
});