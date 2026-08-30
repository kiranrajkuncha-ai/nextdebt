export type MessageRole = "user" | "system";

export type ChatMessageData = {
  id: number;
  role: MessageRole;
  text: string;
  timestamp: string;
  isHtml?: boolean;
};

export function ChatMessage({ message }: { message: ChatMessageData }) {
  const isUser = message.role === "user";
  const isHighlighted = /^(Users \(|Summary for |Transactions for )/i.test(message.text.trim());

  if (message.isHtml) {
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div
          className={[
            "max-w-[82%] rounded-2xl border px-4 py-3 shadow-sm backdrop-blur-sm",
            isUser
              ? "border-sky-500/30 bg-sky-500/10 text-sky-50"
              : "border-slate-700 bg-slate-900/70 text-slate-100",
          ].join(" ")}
        >
          <div
            className="prose prose-invert max-w-none text-[0.96rem] leading-7 [&_table]:min-w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-sm [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3 [&_thead]:bg-slate-800/90 [&_thead]:text-slate-300 [&_tbody_tr]:border-t [&_tbody_tr]:border-slate-700"
            dangerouslySetInnerHTML={{ __html: message.text }}
          />
          <div className={`mt-2 text-[0.68rem] ${isUser ? "text-sky-200/80" : "text-slate-400"}`}>
            {message.timestamp}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[82%] rounded-2xl border px-4 py-3 shadow-sm backdrop-blur-sm",
          isHighlighted
            ? "border-emerald-400/40 bg-gradient-to-r from-emerald-900/30 via-amber-900/10 to-sky-900/20 text-emerald-100 ring-1 ring-emerald-400/10"
            : isUser
            ? "border-sky-500/30 bg-sky-500/10 text-sky-50"
            : "border-slate-700 bg-slate-900/70 text-slate-100",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-4">
          <p className={`whitespace-pre-wrap text-[0.96rem] leading-7 text-current ${isHighlighted ? "text-lg font-semibold" : ""}`}>
            {message.text}
          </p>
          {isHighlighted ? (
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(message.text)}
              className="ml-3 hidden rounded-md border border-emerald-500/30 bg-emerald-600/10 px-2 py-1 text-[0.75rem] text-emerald-200 hover:bg-emerald-600/20 md:inline"
            >
              Copy
            </button>
          ) : null}
        </div>

        <div className={`mt-2 text-[0.68rem] ${isUser ? "text-sky-200/80" : "text-slate-400"}`}>
          {message.timestamp}
        </div>
      </div>
    </div>
  );
}
