import { createAgentUIStreamResponse, type UIMessage } from "ai";
import { debtAgent } from "@/lib/debt-chat";
import { createConfirmedUserResponse } from "@/lib/confirmed-user-response";

export const runtime = "nodejs";
export const maxDuration = 30;

function getSelectedUserFromLatestTurn(messages: UIMessage[]) {
  const lastUserMessage = messages[messages.length - 1];
  const previousAssistantMessage = messages[messages.length - 2];

  if (!lastUserMessage || lastUserMessage.role !== "user") {
    return "";
  }

  if (!previousAssistantMessage || previousAssistantMessage.role !== "assistant") {
    return "";
  }

  const candidateNames = new Set<string>();

  for (const part of previousAssistantMessage.parts) {
    if ((part as { type?: string }).type?.startsWith("tool-") !== true) {
      continue;
    }

    const output = (part as { output?: { status?: string; candidates?: string[] } }).output;
    if (output?.status !== "ambiguous" || !Array.isArray(output.candidates)) {
      continue;
    }

    for (const candidate of output.candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed) candidateNames.add(trimmed);
      }
    }
  }

  if (candidateNames.size === 0) {
    return "";
  }

  const userText = lastUserMessage.parts
    .filter((part) => part.type === "text")
    .map((part) => String((part as { text?: string }).text ?? "").trim())
    .find((text) => text && candidateNames.has(text));

  return userText ?? "";
}

function normalizeMessages(messages: unknown): UIMessage[] {
  if (Array.isArray(messages)) {
    return messages as UIMessage[];
  }

  if (!messages || typeof messages !== "object") {
    return [];
  }

  const messageObject = messages as {
    messages?: unknown;
    message?: unknown;
    body?: unknown;
    role?: unknown;
    parts?: unknown;
  };

  if (Array.isArray(messageObject.messages)) {
    return messageObject.messages as UIMessage[];
  }

  if (messageObject.body && typeof messageObject.body === "object") {
    const nestedMessages = normalizeMessages(messageObject.body);
    if (nestedMessages.length > 0) {
      return nestedMessages;
    }
  }

  if (messageObject.message && typeof messageObject.message === "object") {
    const nestedSingleMessage = normalizeMessages(messageObject.message);
    if (nestedSingleMessage.length > 0) {
      return nestedSingleMessage;
    }
  }

  if (
    messageObject.role === "user" ||
    messageObject.role === "assistant" ||
    Array.isArray(messageObject.parts)
  ) {
    return [messages as UIMessage];
  }

  return [];
}

function sanitizeUIMessageList(messages: unknown): UIMessage[] {
  const extracted = normalizeMessages(messages);

  const validPartTypes = new Set([
    "text",
    "reasoning",
    "tool-call",
    "tool-result",
    "tool-approval-response",
  ]);

  return extracted
    .filter((message): message is UIMessage => {
      if (!message || typeof message !== "object") {
        return false;
      }

      return message.role === "user" || message.role === "assistant";
    })
    .map((message) => ({
      ...message,
      parts: (Array.isArray(message.parts) ? message.parts : []).filter((part) => {
        if (!part || typeof part !== "object") {
          return false;
        }

        const type = (part as { type?: unknown }).type;
        return typeof type === "string" && validPartTypes.has(type);
      }),
    }))
    .filter((message) => Array.isArray(message.parts) && message.parts.length > 0);
}

type ChatRequestBody = {
  messages?: unknown;
  selectedUser?: unknown;
  confirmedUser?: unknown;
  confirmedAction?: unknown;
  body?: {
    messages?: unknown;
    selectedUser?: unknown;
    confirmedUser?: unknown;
    confirmedAction?: unknown;
  };
  message?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const requestBody: ChatRequestBody =
      body && typeof body === "object" ? (body as ChatRequestBody) : {};
    const messages = sanitizeUIMessageList(requestBody);

    const confirmedUser =
      typeof requestBody.selectedUser === "string"
        ? requestBody.selectedUser.trim()
        : typeof requestBody.confirmedUser === "string"
          ? requestBody.confirmedUser.trim()
          : typeof requestBody.body?.selectedUser === "string"
            ? requestBody.body.selectedUser.trim()
            : typeof requestBody.body?.confirmedUser === "string"
              ? requestBody.body.confirmedUser.trim()
              : getSelectedUserFromLatestTurn(messages);

    const confirmedAction =
      requestBody.confirmedAction === "transactions" ? "transactions" : "summary";

    if (confirmedUser) {
      return createConfirmedUserResponse(confirmedUser, confirmedAction);
    }

    return createAgentUIStreamResponse({
      agent: debtAgent,
      uiMessages: messages,
    });
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    const message = error instanceof Error ? error.message : "Failed to process chat request";
    return Response.json({ error: message }, { status: 500 });
  }
}
