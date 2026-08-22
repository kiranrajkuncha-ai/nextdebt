import { ChatMessage, ChatMessageData } from "./ChatMessage";

export function ChatMessageList({
  messages,
  isSending,
}: {
  messages: ChatMessageData[];
  isSending: boolean;
}) {
  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}

      {isSending ? (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-slate-300">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400" />
            <span className="text-sm text-slate-300">System is thinking...</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
