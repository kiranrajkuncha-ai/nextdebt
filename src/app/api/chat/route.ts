import { createGoogle } from "@ai-sdk/google";
import { convertToModelMessages, embed, generateText, Output, type UIMessage } from "ai";
import { z } from "zod";
import { saveDebtRecord, fetchUsers, fetchTransactionsForUser, fetchUserSummary } from "@/lib/db";

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
      return `Summary for ${name}: ${txCount} transactions — Debits: ${debits}, Credits: ${credits}`;
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
      const name = (intentOutput.target_name as string) || (body?.target_name as string);
      if (!name || name.trim().length === 0) {
        return Response.json({ message: "Please provide the user's name to fetch transactions." });
      }
      const tx = await fetchTransactionsForUser(name.trim());
      const formatted = formatIntentResponse("transactions", { name: name.trim(), transactions: tx });
      return Response.json({ intent: "transactions", name: name.trim(), transactions: tx, formatted });
    }

    if (intentOutput.intent === "user_summary") {
      const name = (intentOutput.target_name as string) || (body?.target_name as string);
      if (!name || name.trim().length === 0) {
        return Response.json({ message: "Please provide the user's name to fetch a summary." });
      }
      const summary = await fetchUserSummary(name.trim());
      const formatted = formatIntentResponse("user_summary", { summary });
      return Response.json({ intent: "user_summary", summary, formatted });
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
      const embeddingResult = await embed({
        model: embeddingModel,
        value: originalTranscript || textInput,
        providerOptions: {
          google: {
            outputDimensionality: 1536,
          },
        },
      });
      vectorEmbedding = embeddingResult.embedding ?? null;
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
