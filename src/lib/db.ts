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

async function ensureUserTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
      notes TEXT NOT NULL DEFAULT '',
      original_transcript TEXT NOT NULL DEFAULT '',
      embedding vector,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

void ensureUserTables().catch((error) => {
  console.error("Failed to initialize user/transaction tables:", error);
});

export async function findOrCreateUserByName(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    throw new Error("User name is required");
  }

  const existing = await pool.query(
    `
      SELECT id, name
      FROM users
      WHERE LOWER(name) = LOWER($1)
      LIMIT 1
    `,
    [trimmed],
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await pool.query(
    `
      INSERT INTO users (name)
      VALUES ($1)
      RETURNING id, name
    `,
    [trimmed],
  );

  return created.rows[0];
}

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
  const user = await findOrCreateUserByName(name);

  const result = await pool.query(
    `
      INSERT INTO transactions (
        user_id,
        amount,
        type,
        notes,
        original_transcript,
        embedding
      )
      VALUES ($1, $2, $3, $4, $5, $6::vector)
      RETURNING id, user_id, amount, type, notes, original_transcript, embedding, created_at;
    `,
    [
      user.id,
      Number(amount),
      type,
      notes ?? "",
      originalTranscript ?? "",
      formatEmbeddingForPgVector(embedding),
    ],
  );

  return {
    ...result.rows[0],
    customer_name: user.name,
    user_id: user.id,
  };
}

export async function fetchUsers(): Promise<string[]> {
  const res = await pool.query(`
    SELECT name FROM users
    WHERE name IS NOT NULL AND name <> ''
    ORDER BY name ASC
  `);
  return res.rows.map((r) => r.name as string);
}

export async function fetchTransactionsForUser(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    return [];
  }

  const res = await pool.query(
    `
      SELECT
        t.id,
        u.name AS customer_name,
        t.amount,
        t.type,
        t.notes,
        t.original_transcript,
        t.created_at
      FROM transactions t
      INNER JOIN users u ON u.id = t.user_id
      WHERE LOWER(u.name) = LOWER($1)
      ORDER BY t.created_at DESC
      LIMIT 100
    `,
    [trimmed],
  );

  return res.rows;
}

export async function fetchUserSummary(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    return {
      customer_name: "",
      tx_count: 0,
      total_debits: 0,
      total_credits: 0,
    };
  }

  const res = await pool.query(
    `
      SELECT
        u.name AS customer_name,
        COUNT(*)::int AS tx_count,
        COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'debit'), 0)::float AS total_debits,
        COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'credit'), 0)::float AS total_credits
      FROM transactions t
      INNER JOIN users u ON u.id = t.user_id
      WHERE LOWER(u.name) = LOWER($1)
      GROUP BY u.name
    `,
    [trimmed],
  );

  return res.rows[0] ?? {
    customer_name: trimmed,
    tx_count: 0,
    total_debits: 0,
    total_credits: 0,
  };
}
