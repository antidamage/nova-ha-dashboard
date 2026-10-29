"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * A line typed above the live transcript goes to the voice host as if it had
 * been heard (specs/voice-typed-input.md). The sent line and the reply appear
 * in the log through the transcript stream, so nothing is echoed here; the box
 * only clears on success and keeps the text when the send fails.
 */
export function VoiceTypedInput() {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sentOnce = useRef(false);

  // Disabling the box while sending drops its focus; give it back so the next
  // line can be typed straight away.
  useEffect(() => {
    if (!sending && sentOnce.current) {
      inputRef.current?.focus();
    }
  }, [sending]);

  const send = async () => {
    const message = text.trim();
    if (!message || sending) {
      return;
    }
    sentOnce.current = true;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/voice/typed-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Send failed: ${response.status}`);
      }
      setText("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="voice-typed-input grid gap-1">
      <input
        ref={inputRef}
        type="text"
        className="cyber-text-input"
        aria-label="Type a message to the voice assistant"
        placeholder={sending ? "Sending..." : "Type a message, Enter to send"}
        value={text}
        maxLength={2000}
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {error ? <p role="alert" className="text-xs font-semibold text-red-200">{error}</p> : null}
    </div>
  );
}
