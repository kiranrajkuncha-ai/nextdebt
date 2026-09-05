import { createGoogle } from "@ai-sdk/google";
import { ToolLoopAgent, embed, tool } from "ai";
import { z } from "zod";
import {
  fetchUsers,
  findUserNamesByEmbedding,
  saveDebtRecord,
} from "@/lib/db";

const googleProvider = createGoogle({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const model = googleProvider("gemini-3.6-flash");
const embeddingModel = googleProvider.embedding("gemini-embedding-001");

export function formatUserSummaryHtml(summary: {
  customer_name?: string;
  tx_count?: number;
  total_debits?: number;
  total_credits?: number;
}) {
  const name = summary.customer_name ?? "(unknown)";
  const txCount = summary.tx_count ?? 0;
  const debits =
    typeof summary.total_debits === "number"
      ? Number(summary.total_debits).toFixed(2)
      : summary.total_debits;
  const credits =
    typeof summary.total_credits === "number"
      ? Number(summary.total_credits).toFixed(2)
      : summary.total_credits;

  return `
<div class="mt-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/60 shadow-sm">
  <div class="border-b border-slate-700 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-sky-200">
    Summary / సారాంశం for ${name}
  </div>
  <table class="min-w-full border-collapse text-left text-sm text-slate-200">
    <thead class="bg-slate-800/90 text-xs uppercase tracking-wide text-slate-300">
      <tr>
        <th class="px-4 py-3 font-medium">English</th>
        <th class="px-4 py-3 font-medium">Telugu</th>
      </tr>
    </thead>
    <tbody>
      <tr class="border-t border-slate-700">
        <td class="px-4 py-3 font-medium text-slate-100">User / వినియోగదారు</td>
        <td class="px-4 py-3 text-slate-200">${name}</td>
      </tr>
      <tr class="border-t border-slate-700">
        <td class="px-4 py-3 font-medium text-slate-100">Total Transactions / మొత్తం ట్రాన్సాక్షన్లు</td>
        <td class="px-4 py-3 text-slate-200">${txCount}</td>
      </tr>
      <tr class="border-t border-slate-700">
        <td class="px-4 py-3 font-medium text-slate-100">Debits / డెబిట్లు</td>
        <td class="px-4 py-3 text-slate-200">${debits}</td>
      </tr>
      <tr class="border-t border-slate-700">
        <td class="px-4 py-3 font-medium text-slate-100">Credits / క్రెడిట్లు</td>
        <td class="px-4 py-3 text-slate-200">${credits}</td>
      </tr>
    </tbody>
  </table>
</div>`;
}

export function formatTransactions(name: string, transactions: Array<Record<string, unknown>>) {
  if (transactions.length === 0) {
    return `No transactions found for ${name}.`;
  }

  const lines = transactions.slice(0, 10).map((transaction, index) => {
    const when = transaction.created_at
      ? new Date(String(transaction.created_at)).toLocaleString()
      : "unknown date";
    const amount =
      typeof transaction.amount === "number"
        ? Number(transaction.amount).toFixed(2)
        : transaction.amount;
    const notes = transaction.notes ? ` — ${transaction.notes}` : "";
    return `#${index + 1} ${when}: ${String(transaction.type).toUpperCase()} ${amount}${notes}`;
  });

  return `Transactions for ${name} (${transactions.length}):\n${lines.join("\n")}`;
}

async function createEmbeddingForText(value: string) {
  const text = value.trim();
  if (!text) return null;

  try {
    const embeddingResult = await embed({
      model: embeddingModel,
      value: text,
      providerOptions: {
        google: {
          outputDimensionality: 1536,
        },
      },
    });

    return embeddingResult.embedding ?? null;
  } catch (error) {
    console.warn("Embedding generation failed:", error);
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) {
    return 0;
  }

  const length = Math.min(a.length, b.length);
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    magnitudeA += a[index] * a[index];
    magnitudeB += b[index] * b[index];
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

function normalizeUserName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fuzzyUserSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeUserName(left);
  const normalizedRight = normalizeUserName(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.92;
  }

  const longerLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (longerLength === 0) {
    return 0;
  }

  const distance = (() => {
    const matrix = Array.from({ length: normalizedLeft.length + 1 }, () =>
      Array(normalizedRight.length + 1).fill(0),
    );

    for (let row = 0; row <= normalizedLeft.length; row += 1) {
      matrix[row][0] = row;
    }

    for (let column = 0; column <= normalizedRight.length; column += 1) {
      matrix[0][column] = column;
    }

    for (let row = 1; row <= normalizedLeft.length; row += 1) {
      for (let column = 1; column <= normalizedRight.length; column += 1) {
        const cost = normalizedLeft[row - 1] === normalizedRight[column - 1] ? 0 : 1;
        matrix[row][column] = Math.min(
          matrix[row - 1][column] + 1,
          matrix[row][column - 1] + 1,
          matrix[row - 1][column - 1] + cost,
        );
      }
    }

    return matrix[normalizedLeft.length][normalizedRight.length];
  })();

  return 1 - distance / longerLength;
}

function isReadOnlyRequest(value: string) {
  const normalized = value.toLowerCase();
  return /\b(summary|summarize|balance|transaction|transactions|history|report|show|view|list)\b/.test(
    normalized,
  );
}

async function findSimilarUsers(
  query: string,
  candidateUsers: string[],
  limit = 5,
  minSimilarity = 0.75,
) {
  const trimmed = query.trim();
  if (!trimmed || candidateUsers.length === 0) {
    return [];
  }

  const queryEmbedding = await createEmbeddingForText(trimmed);

  const matches = await Promise.all(
    candidateUsers.map(async (userName) => {
      const candidate = userName.trim();
      if (!candidate) {
        return null;
      }

      const isExactMatch = candidate.toLowerCase() === trimmed.toLowerCase();
      const candidateEmbedding = await createEmbeddingForText(candidate);
      const nameSimilarity = fuzzyUserSimilarity(trimmed, candidate);
      const embeddingSimilarity =
        queryEmbedding && candidateEmbedding
          ? cosineSimilarity(queryEmbedding, candidateEmbedding)
          : 0;
      const similarity = isExactMatch ? 1 : Math.max(embeddingSimilarity, nameSimilarity);

      if (similarity < minSimilarity) {
        return null;
      }

      return {
        name: candidate,
        similarity,
      };
    }),
  );

  return matches
    .filter((item): item is { name: string; similarity: number } => Boolean(item))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit)
    .map((item) => item.name);
}

export async function resolveUserLookup(name: string, options?: { forceResolve?: boolean }) {
  const forceResolve = options?.forceResolve ?? false;
  const users = await fetchUsers();
  const trimmed = name.trim();

  if (!trimmed) {
    return {
      status: "missing_name" as const,
      users,
    };
  }

  if (forceResolve) {
    const exactUser = users.find((user) => user.toLowerCase() === trimmed.toLowerCase()) ?? null;

    const queryEmbedding = await createEmbeddingForText(trimmed);
    const embeddingMatches = await findUserNamesByEmbedding(queryEmbedding);

    const matchedUserNames = Array.from(
      new Set([...(exactUser ? [exactUser] : []), ...embeddingMatches]),
    );

    if (matchedUserNames.length > 0) {
      return {
        status: "resolved" as const,
        userName: matchedUserNames[0],
        userNames: matchedUserNames,
        users,
      };
    }

    return {
      status: "not_found" as const,
      users,
    };
  }

  const similarUsers = await findSimilarUsers(trimmed, users, 10, 0.72);

  if (similarUsers.length >= 1) {
    return {
      status: "ambiguous" as const,
      candidates: similarUsers,
      users,
    };
  }

  return {
    status: "not_found" as const,
    users,
  };
}

export const debtTools = {
  listUsers: tool({
    description: "List all users/customers in the debt system.",
    inputSchema: z.object({}),
    execute: async () => {
      const users = await fetchUsers();
      return {
        status: "ok",
        users,
        message:
          users.length === 0
            ? "No users found."
            : `Users (${users.length}): ${users.join(", ")}`,
      };
    },
  }),

  getUserSummary: tool({
    description:
      "Search for similar users and return name suggestions. Never returns the final summary directly — only candidate names.",
    inputSchema: z.object({
      name: z.string().describe("The user/customer name to search for"),
    }),
    execute: async ({ name }) => {
      const lookup = await resolveUserLookup(name);

      if (lookup.status === "ambiguous") {
        return {
          status: "ambiguous",
          candidates: lookup.candidates,
          message: `Did you mean one of these users? ${lookup.candidates.join(", ")}`,
        };
      }

      if (lookup.status === "missing_name" || lookup.status === "not_found") {
        return {
          status: lookup.status,
          users: lookup.users,
          message:
            lookup.status === "missing_name"
              ? "Please provide a user name."
              : `No user found matching "${name}".`,
        };
      }

      return {
        status: "not_found",
        users: lookup.users,
        message: `No similar users found for "${name}".`,
      };
    },
  }),

  getTransactions: tool({
    description:
      "Search for similar users before showing transactions. Return candidate names first; do not show transactions until the user picks a name.",
    inputSchema: z.object({
      name: z.string().describe("The user/customer name"),
    }),
    execute: async ({ name }) => {
      const lookup = await resolveUserLookup(name);

      if (lookup.status === "ambiguous") {
        return {
          status: "ambiguous",
          candidates: lookup.candidates,
          message: `Did you mean one of these users? ${lookup.candidates.join(", ")}`,
        };
      }

      if (lookup.status === "missing_name" || lookup.status === "not_found") {
        return {
          status: lookup.status,
          users: lookup.users,
          message:
            lookup.status === "missing_name"
              ? "Please provide a user name."
              : `No user found matching "${name}".`,
        };
      }

      return {
        status: "not_found",
        users: lookup.users,
        message: `No similar users found for "${name}".`,
      };
    },
  }),

  createDebt: tool({
    description:
      "Create a new debt record only when the user explicitly records money owed information. Never use this for summaries, balances, transaction history, reports, or other read-only requests.",
    inputSchema: z.object({
      name: z.string().describe("Person or customer name"),
      amount: z.number().describe("Transaction amount"),
      type: z.enum(["credit", "debit"]).describe("credit = received, debit = given/owed"),
      notes: z.string().optional().describe("Short notes about the transaction"),
      originalTranscript: z.string().describe("Exact original user message that explicitly records the debt"),
    }),
    execute: async ({ name, amount, type, notes, originalTranscript }) => {
      if (isReadOnlyRequest(originalTranscript)) {
        return {
          status: "rejected",
          message: "This is a read-only request. Do not create a debt record; provide the requested summary or history instead.",
        };
      }

      const embedding = await createEmbeddingForText(
        originalTranscript?.trim() || notes?.trim() || name,
      );

      const saved = await saveDebtRecord({
        name,
        amount,
        type,
        notes,
        originalTranscript,
        embedding,
      });

      return {
        status: "ok",
        saved,
        message: `Saved debt for ${saved.customer_name}: ${type.toUpperCase()} ${Number(amount).toFixed(2)}${notes ? ` — ${notes}` : ""}`,
      };
    },
  }),
};

export const debtAgent = new ToolLoopAgent({
  model,
  instructions: `You are a debt-tracking assistant for a grocery shop. Users speak Telugu and English.

Use the available tools to:
- list users
- show user summaries
- show transactions
- create debt/credit records

Rules:
- For summaries, always call getUserSummary first to show similar name suggestions.
- Never assume the summary is final until the user picks one name from the suggestion list shown in the UI.
- When the user picks a name from suggestions, the app will fetch the summary directly — you do not need to call getUserSummary again for that pick.
- For transaction history, call getTransactions to show similar name suggestions first.
- For new debt entries like "Kiran gave 200", call createDebt and pass the exact user message as originalTranscript.
- Never call createDebt for a summary, balance, transaction history, report, or other read-only request. If createDebt returns status "rejected", do not retry it.
- If a tool returns status "ambiguous", tell the user to pick one of the suggested names.
- Keep replies concise and helpful in Telugu or English, matching the user's language.`,
  tools: debtTools,
});
