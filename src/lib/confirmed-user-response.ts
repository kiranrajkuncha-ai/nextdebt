import { createUIMessageStream, createUIMessageStreamResponse, generateId } from "ai";
import {
  fetchTransactionsForUser,
  fetchUserSummary,
} from "@/lib/db";
import { formatUserSummaryHtml, formatTransactions, resolveUserLookup } from "@/lib/debt-chat";

function createTextStreamResponse(text: string) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        const id = generateId();
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: text });
        writer.write({ type: "text-end", id });
      },
    }),
  });
}

export async function createConfirmedUserResponse(
  userName: string,
  action: "summary" | "transactions" = "summary",
) {
  const lookup = await resolveUserLookup(userName, { forceResolve: true });

  if (lookup.status !== "resolved") {
    return createTextStreamResponse(`No user found matching "${userName}".`);
  }

  if (action === "transactions") {
    const transactions = await fetchTransactionsForUser(lookup.userName);
    return createTextStreamResponse(formatTransactions(lookup.userName, transactions));
  }

  const summary = await fetchUserSummary(lookup.userName);
  return createTextStreamResponse(formatUserSummaryHtml(summary));
}
