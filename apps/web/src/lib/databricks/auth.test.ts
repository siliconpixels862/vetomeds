import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getWorkspaceToken } from './auth';

describe('getWorkspaceToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.DATABRICKS_TOKEN;
    delete process.env.DATABRICKS_CLIENT_ID;
    delete process.env.DATABRICKS_CLIENT_SECRET;
  });

  it('returns DATABRICKS_TOKEN directly without calling fetch when set', async () => {
    process.env.DATABRICKS_TOKEN = 'pat-token-123';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const token = await getWorkspaceToken();

    expect(token).toBe('pat-token-123');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
