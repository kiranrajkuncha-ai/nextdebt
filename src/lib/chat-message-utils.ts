import type { UIMessage } from "ai";

type ToolOutput = {
  status?: string;
  candidates?: string[];
  html?: string;
  formatted?: string;
  message?: string;
};

function getToolOutput(part: { type: string; state?: string; output?: unknown }) {
  if (!part.type.startsWith("tool-") || part.state !== "output-available") {
    return null;
  }

  return (part.output ?? null) as ToolOutput | null;
}

export function getRenderableMessageContent(message: UIMessage) {
  const chunks: string[] = [];
  let isHtml = false;

  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) {
      chunks.push(part.text.trim());
      if (/<table|<div[^>]*class=/.test(part.text)) {
        isHtml = true;
      }
      continue;
    }

    const output = getToolOutput(part);
    if (!output) {
      continue;
    }

    if (output.status === "ok" && output.html) {
      chunks.push(output.html);
      isHtml = true;
      continue;
    }

    if (output.formatted) {
      chunks.push(output.formatted);
      continue;
    }

    if (output.message) {
      chunks.push(output.message);
    }
  }

  return {
    text: chunks.join("\n\n"),
    isHtml,
  };
}

export function getCandidateUsers(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      const output = getToolOutput(part);
      if (output?.status === "ambiguous" && Array.isArray(output.candidates)) {
        return output.candidates;
      }
    }

    return [];
  }
}
