import { getWorkspaceToken } from './auth';

export interface SqlParam {
  name: string;
  value: string;
}

interface StatementColumn {
  name: string;
}

interface StatementResponse {
  statement_id?: string;
  status?: { state?: string; error?: { message?: string } };
  manifest?: { schema?: { columns?: StatementColumn[] } };
  result?: { data_array?: unknown[][] };
  message?: string;
}

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 90_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * fetch() wrapper that survives the two flaky conditions Databricks serverless throws
 * at us: a cold-warehouse connection reset (the low-level "fetch failed" TypeError) and
 * transient 5xx/429 responses. Retries with capped exponential backoff so the very first
 * query after an idle period does not surface an error to the user.
 */
async function fetchWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url, init);
      if (RETRYABLE_STATUS.has(resp.status) && i < attempts - 1) {
        await sleep(600 * 2 ** i);
        continue;
      }
      return resp;
    } catch (err) {
      // Thrown fetch errors ("fetch failed", ECONNRESET, socket timeouts) are transient
      // against a waking warehouse — back off and retry.
      lastErr = err;
      if (i < attempts - 1) {
        await sleep(600 * 2 ** i);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function execSql(
  query: string,
  params?: SqlParam[]
): Promise<Record<string, unknown>[]> {
  const host = process.env.DATABRICKS_HOST;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!host) throw new Error('DATABRICKS_HOST is not set');
  if (!warehouseId) throw new Error('DATABRICKS_WAREHOUSE_ID is not set');

  const token = await getWorkspaceToken();
  const body: Record<string, unknown> = {
    statement: query,
    warehouse_id: warehouseId,
    // Keep the initial POST short so a cold/slow warehouse returns PENDING quickly
    // instead of holding the connection open long enough for undici to drop it.
    wait_timeout: '5s',
    on_wait_timeout: 'CONTINUE',
  };
  if (params) body.parameters = params;

  let resp = await fetchWithRetry(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = (await resp.json()) as StatementResponse;

  if (!resp.ok) {
    throw new Error(
      `Databricks SQL request failed (${resp.status}): ${json.message ?? JSON.stringify(json)}`
    );
  }

  const started = Date.now();
  while (json.status?.state === 'PENDING' || json.status?.state === 'RUNNING') {
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new Error('Databricks SQL statement polling timed out after 90s');
    }
    await sleep(POLL_INTERVAL_MS);
    resp = await fetchWithRetry(`${host}/api/2.0/sql/statements/${json.statement_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Databricks SQL poll failed (${resp.status}): ${text}`);
    }

    json = (await resp.json()) as StatementResponse;
  }

  if (json.status?.state !== 'SUCCEEDED') {
    const errMsg = json.status?.error?.message ?? json.message ?? JSON.stringify(json.status ?? json);
    throw new Error(`Databricks SQL statement failed: ${errMsg}`);
  }

  const columns = json.manifest?.schema?.columns ?? [];
  const rows = json.result?.data_array ?? [];
  return rows.map(row => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });
}
