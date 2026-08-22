import { Pool } from "pg";

const getConnectionString = () => {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME;
  const dbHost = process.env.DB_HOST ?? "127.0.0.1";
  const dbPort = process.env.DB_PORT ?? "5432";

  if (!dbUser || !dbPassword || !dbName) {
    throw new Error("Missing DB env vars: DB_USER, DB_PASSWORD, and DB_NAME");
  }

  const encodedPassword = encodeURIComponent(dbPassword);

  // For local dev, use Cloud SQL Auth Proxy on localhost:5432.
  // Example: cloud-sql-proxy --port 5432 nextdebt:asia-south1:nextdebt
  return `postgresql://${dbUser}:${encodedPassword}@${dbHost}:${dbPort}/${dbName}`;
};

export const pool = new Pool({
  connectionString: getConnectionString(),
  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized: false,
        }
      : false,
});

const formatEmbeddingForPgVector = (embedding?: number[] | null) => {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return null;
  }

  return `[${embedding.map((value) => Number(value).toFixed(6)).join(",")}]`;
};

export async function saveDebtRecord({
  name,
  amount,
  type,
  notes,
  originalTranscript,
  embedding,
}: {
  name: string;
  amount: number;
  type: "credit" | "debit";
  notes?: string;
  originalTranscript?: string;
  embedding?: number[] | null;
}) {
  const result = await pool.query(
    `
      INSERT INTO debt_entries (
        customer_name,
        amount,
        type,
        notes,
        original_transcript,
        embedding
      )
      VALUES ($1, $2, $3, $4, $5, $6::vector)
      RETURNING id, customer_name, amount, type, notes, original_transcript, embedding, created_at;
    `,
    [
      name.trim(),
      Number(amount),
      type,
      notes ?? "",
      originalTranscript ?? "",
      formatEmbeddingForPgVector(embedding),
    ],
  );

  return result.rows[0];
}

export async function fetchUsers(): Promise<string[]> {
  const res = await pool.query(`
    SELECT DISTINCT customer_name FROM debt_entries
    WHERE customer_name IS NOT NULL AND customer_name <> ''
    ORDER BY customer_name ASC
  `);
  return res.rows.map((r) => r.customer_name as string);
}

export async function fetchTransactionsForUser(name: string) {
  const res = await pool.query(
    `
      SELECT id, customer_name, amount, type, notes, original_transcript, created_at
      FROM debt_entries
      WHERE customer_name = $1
      ORDER BY created_at DESC
      LIMIT 100
    `,
    [name],
  );
  return res.rows;
}

export async function fetchUserSummary(name: string) {
  const res = await pool.query(
    `
      SELECT
        customer_name,
        COUNT(*)::int AS tx_count,
        COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0)::float AS total_debits,
        COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0)::float AS total_credits
      FROM debt_entries
      WHERE customer_name = $1
      GROUP BY customer_name
    `,
    [name],
  );

  return res.rows[0] ?? {
    customer_name: name,
    tx_count: 0,
    total_debits: 0,
    total_credits: 0,
  };
}
