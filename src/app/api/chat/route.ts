import { createGoogle } from "@ai-sdk/google";
import { convertToModelMessages, embed, generateText, Output, type UIMessage } from "ai";
import { z } from "zod";
import {
  saveDebtRecord,
  fetchUsers,
  fetchTransactionsForUser,
  fetchUserSummary,
} from "@/lib/db";

const googleProvider = createGoogle({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const model = googleProvider("gemini-3.6-flash");
const embeddingModel = googleProvider.embedding("gemini-embedding-001");

const debtEntrySchema = z.object({
  name: z.string().nullable(),
  amount: z.number().nullable(),
  type: z.enum(["credit", "debit", "unknown"]),
  notes: z.string(),
});

const intentSchema = z.object({
  intent: z.enum(["create_debt", "user_summary", "list_users", "transactions", "unknown"]),
  target_name: z.string().nullable(),
});

function formatIntentResponse(intent: string, payload: any) {
  switch (intent) {
    case "list_users": {
      const users: string[] = payload.users ?? [];
      if (users.length === 0) return "No users found.";
      return `Users (${users.length}): ${users.join(", ")}`;
    }

    case "transactions": {
      const name = payload.name ?? "(unknown)";
      const tx: any[] = payload.transactions ?? [];
      if (tx.length === 0) return `No transactions found for ${name}.`;
      const lines = tx.slice(0, 10).map((t, i) => {
        const when = t.created_at ? new Date(t.created_at).toLocaleString() : "unknown date";
        const amount = typeof t.amount === "number" ? Number(t.amount).toFixed(2) : t.amount;
        const notes = t.notes ? ` — ${t.notes}` : "";
        return `#${i + 1} ${when}: ${t.type.toUpperCase()} ${amount}${notes}`;
      });
      return `Transactions for ${name} (${tx.length}):\n` + lines.join("\n");
    }

    case "user_summary": {
      const s = payload.summary ?? {};
      const name = s.customer_name ?? "(unknown)";
      const txCount = s.tx_count ?? 0;
      const debits = typeof s.total_debits === "number" ? Number(s.total_debits).toFixed(2) : s.total_debits;
      const credits = typeof s.total_credits === "number" ? Number(s.total_credits).toFixed(2) : s.total_credits;

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

    case "create_debt": {
      const saved = payload.saved ?? null;
      const v = payload.validDebt ?? {};
      const name = saved?.customer_name ?? v.name ?? "(unknown)";
      const amount = (saved?.amount ?? v.amount) != null ? Number(saved?.amount ?? v.amount).toFixed(2) : "0.00";
      const type = (saved?.type ?? v.type ?? "").toString().toUpperCase();
      return `Saved debt for ${name}: ${type} ${amount}` + (v.notes ? ` — ${v.notes}` : "");
    }

    default:
      return "I couldn't understand the request. Please try again with a clearer query.";
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;

async function createEmbeddingForText(value: string) {
  const text = value.trim();

  if (!text) {
    return null;
  }

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

async function findSimilarUsers(query: string, candidateUsers: string[], limit = 5, minSimilarity = 0.9) {
  const trimmed = query.trim();

  if (!trimmed || candidateUsers.length === 0) {
    return [];
  }

  const queryEmbedding = await createEmbeddingForText(trimmed);

  if (!queryEmbedding) {
    return [];
  }

  const matches = await Promise.all(
    candidateUsers.map(async (userName) => {
      const candidate = userName.trim();

      if (!candidate || candidate.toLowerCase() === trimmed.toLowerCase()) {
        return null;
      }

      const candidateEmbedding = await createEmbeddingForText(candidate);

      if (!candidateEmbedding) {
        return null;
      }

      const similarity = cosineSimilarity(queryEmbedding, candidateEmbedding);

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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const textInput = typeof body?.text === "string" ? body.text.trim() : "";
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    // First, classify the user's intent (create a debt record vs. read queries)
    const intentResult = await generateText({
      model,
      output: Output.object({ schema: intentSchema }),
      ...(textInput
        ? { prompt: `Classify the intent of this user message: "${textInput}"` }
        : messages.length > 0
        ? { messages: await convertToModelMessages(messages as UIMessage[]) }
        : { prompt: "Classify the intent of this request." }),
      system: `Classify the user's intent into one of: create_debt, user_summary, list_users, transactions. If the user asks about a particular person, set target_name to that person's name; otherwise null. Respond only with JSON matching the schema.`,
    });

    const intentOutput = intentResult.output ?? { intent: "unknown", target_name: null };

    if (intentOutput.intent === "list_users") {
      const users = await fetchUsers();
      const formatted = formatIntentResponse("list_users", { users });
      return Response.json({ intent: "list_users", users, formatted });
    }

    if (intentOutput.intent === "transactions") {
      const rawName = (intentOutput.target_name as string) || (body?.target_name as string) || textInput;
      const users = await fetchUsers();

      if (!rawName || rawName.trim().length === 0) {
        return Response.json({
          intent: "list_users",
          users,
          formatted: formatIntentResponse("list_users", { users }),
        });
      }

      const userName = rawName.trim();
      const exactUser = users.find((user) => user.toLowerCase() === userName.toLowerCase());
      const similarUsers = await findSimilarUsers(userName, users, 5, 0.9);

      if (similarUsers.length > 0) {
        return Response.json({
          intent: "candidate_users",
          users: similarUsers,
          formatted: `Did you mean one of these users? ${similarUsers.join(", ")}`,
        });
      }

      if (exactUser) {
        const tx = await fetchTransactionsForUser(exactUser);
        const formatted = formatIntentResponse("transactions", { name: exactUser, transactions: tx });
        return Response.json({ intent: "transactions", name: exactUser, transactions: tx, formatted });
      }

      return Response.json({
        intent: "list_users",
        users,
        formatted: formatIntentResponse("list_users", { users }),
      });
    }

    if (intentOutput.intent === "user_summary") {
      const rawName = (intentOutput.target_name as string) || (body?.target_name as string) || textInput;
      const users = await fetchUsers();

      if (!rawName || rawName.trim().length === 0) {
        return Response.json({
          intent: "list_users",
          users,
          formatted: formatIntentResponse("list_users", { users }),
        });
      }

      const userName = rawName.trim();
      const exactUser = users.find((user) => user.toLowerCase() === userName.toLowerCase());
      const similarUsers = await findSimilarUsers(userName, users, 5, 0.9);

      if (similarUsers.length > 0) {
        return Response.json({
          intent: "candidate_users",
          users: similarUsers,
          formatted: `Did you mean one of these users? ${similarUsers.join(", ")}`,
        });
      }

      if (exactUser) {
        const summary = await fetchUserSummary(exactUser);
        const formatted = formatIntentResponse("user_summary", { summary });
        return Response.json({ intent: "user_summary", summary, formatted });
      }

      return Response.json({
        intent: "list_users",
        users,
        formatted: formatIntentResponse("list_users", { users }),
      });
    }

    // Default to creating a debt record when intent is create_debt or unknown
    const result = await generateText({
      model,
      output: Output.object({
        schema: debtEntrySchema,
      }),
      ...(textInput
        ? { prompt: textInput }
        : messages.length > 0
        ? { messages: await convertToModelMessages(messages as UIMessage[]) }
        : { prompt: "Extract the debt details from the provided message." }),
      system: `You are a debt-entry parser. Extract fields from the user's text.

Rules:
- name: the person or creditor name mentioned
- amount: number as a float, or null if found
- type: one of "credit", "debit", or "unknown"
- notes: brief summary in plain text

If information is missing, set null or "unknown" accordingly.
Return valid JSON that matches the schema exactly.`,
    });

    const output = result.output ?? {
      name: null,
      amount: null,
      type: "unknown",
      notes: "",
    };

    const hasRequiredFields =
      typeof output.name === "string" &&
      output.name.trim().length > 0 &&
      typeof output.amount === "number" &&
      Number.isFinite(output.amount) &&
      typeof output.type === "string" &&
      ["credit", "debit"].includes(output.type);

    if (!hasRequiredFields) {
      return Response.json({
        message: "Please give input one more time",
      });
    }

    const originalTranscript = typeof body?.original_transcript === "string"
      ? body.original_transcript.trim()
      : textInput;

    const embedding = Array.isArray(body?.embedding)
      ? body.embedding
          .map((value: unknown) => Number(value))
          .filter((value: number) => Number.isFinite(value))
      : [];

    let vectorEmbedding: number[] | null = null;

    try {
      vectorEmbedding = await createEmbeddingForText(originalTranscript || textInput);
    } catch (embedError) {
      console.warn("Embedding generation failed for debt record:", embedError);
      vectorEmbedding = embedding.length > 0 ? embedding : null;
    }

    const validDebt = {
      name: output.name as string,
      amount: output.amount as number,
      type: output.type as "credit" | "debit",
      notes: typeof output.notes === "string" ? output.notes : "",
      originalTranscript,
      embedding: vectorEmbedding ?? (embedding.length > 0 ? embedding : null),
    };

    const savedDebt = await saveDebtRecord(validDebt);
    const formatted = formatIntentResponse("create_debt", { saved: savedDebt, validDebt });

    return Response.json({ intent: "create_debt", object: output, saved: savedDebt, formatted });
  } catch (error: any) {
    console.error("Chat API error:", error);
    return Response.json(
      { error: error?.message || "Failed to process chat request" },
      { status: 500 },
    );
  }
}
