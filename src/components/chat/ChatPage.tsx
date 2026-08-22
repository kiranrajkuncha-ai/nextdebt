"use client";

import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import type { ChatMessageData } from "./ChatMessage";

const starterMessages: ChatMessageData[] = [
  {
    id: 1,
    role: "system",
    text: "నమస్కారం! మీ యాప్ ఫ్లోను డిజైన్ చేయడంలో, సమీక్షించడంలో లేదా మెరుగుపరచడంలో నేను మీకు సహాయం చేయగలను. మీ ప్రాజెక్ట్ గురించి ఏ విషయం గురించైనా నన్ను అడగండి",
    timestamp: "9:41 AM",
  }
];

const chatHistory = [
  "Debt dashboard ideas",
  "User flow review",
  "Onboarding suggestions",
  "Landing page copy",
  "Checkout UX notes",
];

const formatTimestamp = () =>
  new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

const appendMessage = (
  messages: ChatMessageData[],
  text: string,
  role: "user" | "system",
): ChatMessageData[] => [
  ...messages,
  {
    id: Date.now() + Math.random(),
    role,
    text,
    timestamp: formatTimestamp(),
  },
];

export function ChatPage() {
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessageData[]>(starterMessages);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const sendToDebtParser = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: trimmed }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to analyze debt message");
      }

      const data = await response.json();

      // Prefer the human-readable `formatted` string from the API when present.
      let formatted: string;
      if (typeof data?.formatted === "string" && data.formatted.trim().length > 0) {
        formatted = data.formatted;
      } else {
        const object = data?.object ?? data;
        formatted = typeof object === "string" ? object : JSON.stringify(object, null, 2);
      }

      setMessages((current) => appendMessage(current, formatted, "system"));
    } catch (error) {
      console.error("Debt parser request failed:", error);
      setMessages((current) =>
        appendMessage(current, "I could not parse that debt entry. Please try again.", "system"),
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMessage = (valueOverride?: string) => {
    const trimmed = (valueOverride ?? input).trim();
    if (!trimmed || isSending) return;

    setMessages((current) => appendMessage(current, trimmed, "user"));
    setInput("");
    void sendToDebtParser(trimmed);
  };

  const handleVoiceToggle = () => {
    if (isListening) {
      setIsListening(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    setInput("Listening…");
    setIsListening(true);
    startRecording();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options: MediaRecorderOptions = { mimeType: "audio/webm" };
      const mr = new MediaRecorder(stream, options);
      audioChunksRef.current = [];

      mr.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data);
      });

      mr.addEventListener("stop", async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });

        try {
          const form = new FormData();
          form.append("file", blob, "voice.webm");

          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });

          if (!res.ok) {
            const txt = await res.text();
            console.error("Transcription error:", txt);
            setInput("");
            return;
          }

          const json = await res.json();
          const transcript = (json.transcript as string) || "";
          const finalText = transcript.trim();

          if (!finalText) {
            setInput("");
            return;
          }

          setInput(finalText);
          setIsListening(false);
        } catch (err) {
          console.error(err);
        }
      });

      mediaRecorderRef.current = mr;
      mr.start();
    } catch (err) {
      console.error("Microphone access denied or not available", err);
      setIsListening(false);
      setInput("");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070d18] px-4 py-8 text-slate-100">
      <div className="flex h-[92vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-800 bg-[#0b1220] shadow-[0_30px_80px_rgba(15,23,42,0.9)]">
        <aside className="hidden w-[260px] border-r border-slate-800 bg-slate-950/60 p-5 lg:block">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">History</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Chats</h2>
            </div>
            <button type="button" className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:border-slate-600">
              + New
            </button>
          </div>

          <div className="space-y-2">
            {chatHistory.map((item, index) => (
              <button
                key={item}
                type="button"
                className={[
                  "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition",
                  index === 0
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200",
                ].join(" ")}
              >
                <span className="truncate">{item}</span>
                <span className="ml-2 text-[10px] text-slate-500">{index + 1}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sm font-semibold text-sky-300">
                AI
              </div>
              <div>
                <p className="text-sm font-medium text-white">Copilot</p>
                <p className="text-xs text-emerald-400">Online</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <button type="button" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 hover:border-slate-600">
                New chat
              </button>
            </div>
          </header>

          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <div className="mx-auto max-w-4xl">
                <ChatMessageList messages={messages} isSending={isSending} />
                <div ref={bottomRef} />
              </div>
            </div>

            <ChatComposer
              value={input}
              onChange={setInput}
              onSend={handleSendMessage}
              onVoiceToggle={handleVoiceToggle}
              isSending={isSending}
              isListening={isListening}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
