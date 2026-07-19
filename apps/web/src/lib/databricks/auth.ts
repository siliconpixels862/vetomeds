interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry

/**
 * Resolves a bearer token for calling the Databricks workspace REST APIs.
 * - Local dev: if DATABRICKS_TOKEN (a PAT) is set, it is returned as-is.
 * - Deployed app: mints an OAuth M2M token via client_credentials and caches
 *   it in module scope until ~5 minutes before it expires.
 */
export async function getWorkspaceToken(): Promise<string> {
  if (process.env.DATABRICKS_TOKEN) {
    return process.env.DATABRICKS_TOKEN;
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - REFRESH_MARGIN_MS > now) {
    return cachedToken.token;
  }

  const host = process.env.DATABRICKS_HOST;
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!host || !clientId || !clientSecret) {
    throw new Error(
      'Missing Databricks credentials: set DATABRICKS_TOKEN for local dev, or DATABRICKS_HOST + DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET for OAuth M2M.'
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(`${host}/oidc/v1/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=all-apis',
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to mint Databricks OAuth token (${resp.status}): ${text}`);
  }

  const json = (await resp.json()) as { access_token: string; expires_in?: number };
  const expiresInMs = (json.expires_in ?? 3600) * 1000;
  cachedToken = { token: json.access_token, expiresAt: now + expiresInMs };
  return cachedToken.token;
}
