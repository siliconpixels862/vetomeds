import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { getWorkspaceToken } from './auth';

interface CachedLakebase {
  pool: Pool;
  createdAt: number;
}

let cached: CachedLakebase | null = null;

const POOL_MAX_AGE_MS = 50 * 60 * 1000; // recreate the pool/credential after 50 minutes

async function mintLakebaseCredential(): Promise<string> {
  const host = process.env.DATABRICKS_HOST;
  if (!host) throw new Error('DATABRICKS_HOST is not set');

  const token = await getWorkspaceToken();
  const instanceName = process.env.LAKEBASE_INSTANCE ?? 'data-legend-db';

  const resp = await fetch(`${host}/api/2.0/database/credentials`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      request_id: randomUUID(),
      instance_names: [instanceName],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to mint Lakebase credential (${resp.status}): ${text}`);
  }

  const json = (await resp.json()) as { token?: string };
  if (!json.token) {
    throw new Error('Lakebase credential response missing "token" field');
  }
  return json.token;
}

async function getPool(): Promise<Pool> {
  const now = Date.now();
  if (cached && now - cached.createdAt < POOL_MAX_AGE_MS) {
    return cached.pool;
  }

  const stale = cached;
  const password = await mintLakebaseCredential();
  const pool = new Pool({
    host: process.env.PGHOST,
    port: 5432,
    database: process.env.PGDATABASE ?? 'databricks_postgres',
    user: process.env.PGUSER,
    password,
    ssl: { rejectUnauthorized: false },
  });

  cached = { pool, createdAt: now };

  if (stale) {
    // Best-effort close of the previous pool; don't block on it.
    stale.pool.end().catch(() => {});
  }

  return pool;
}

export async function lakebaseQuery<T>(text: string, values?: unknown[]): Promise<T[]> {
  const pool = await getPool();
  const result = await pool.query(text, values);
  return result.rows as T[];
}
