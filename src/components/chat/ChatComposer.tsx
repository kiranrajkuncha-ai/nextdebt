import { useEffect, useRef } from "react";

type ChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: (value?: string) => void;
  onVoiceToggle: () => void;
  isSending: boolean;
  isListening: boolean;
};

export function ChatComposer({
  value,
  onChange,
  onSend,
  onVoiceToggle,
  isSending,
  isListening,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className="border-t border-slate-800/80 bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-700 bg-slate-900/80 p-3 shadow-2xl shadow-slate-950/50">
        <div className="flex items-end gap-3">
          <button
            type="button"
            onClick={onVoiceToggle}
            aria-label="Toggle voice input"
            className={[
              "flex h-11 w-11 items-center justify-center rounded-xl border text-lg transition",
              isListening
                ? "border-rose-500/60 bg-rose-500/15 text-rose-300 shadow-lg shadow-rose-500/20"
                : "border-slate-700 bg-slate-800 text-slate-200 hover:border-sky-500/40 hover:text-sky-300",
            ].join(" ")}
          >
            {isListening ? "◉" : "🎙"}
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend(value);
              }
            }}
            rows={1}
            placeholder="Message Copilot..."
            className="max-h-[180px] min-h-[44px] flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-3 text-base text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />

          <button
            type="button"
            onClick={() => onSend(value)}
            disabled={isSending || !value.trim()}
            className="flex h-11 items-center justify-center rounded-xl bg-sky-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
