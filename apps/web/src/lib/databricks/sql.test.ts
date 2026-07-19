import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execSql } from './sql';

describe('execSql', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.DATABRICKS_HOST = 'https://example.cloud.databricks.com';
    process.env.DATABRICKS_TOKEN = 'test-token';
    process.env.DATABRICKS_WAREHOUSE_ID = 'wh123';
  });

  it('maps data_array + schema columns into objects keyed by column name', async () => {
    const mockResponse = {
      statement_id: 'stmt-1',
      status: { state: 'SUCCEEDED' },
      manifest: { schema: { columns: [{ name: 'n' }, { name: 'name' }] } },
      result: {
        data_array: [
          ['10000', 'Apollo'],
          ['5', 'Fortis'],
        ],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await execSql('SELECT COUNT(*) AS n FROM x');

    expect(rows).toEqual([
      { n: '10000', name: 'Apollo' },
      { n: '5', name: 'Fortis' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.cloud.databricks.com/api/2.0/sql/statements',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      })
    );
  });

  it('throws with the server error message when the statement state is FAILED', async () => {
    const mockResponse = {
      statement_id: 'stmt-2',
      status: { state: 'FAILED', error: { message: 'Table not found' } },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(execSql('SELECT * FROM missing')).rejects.toThrow('Table not found');
  });

  it('polls until the statement transitions from PENDING to SUCCEEDED', async () => {
    vi.useFakeTimers();
    const pending = {
      statement_id: 'stmt-3',
      status: { state: 'PENDING' },
    };
    const succeeded = {
      statement_id: 'stmt-3',
      status: { state: 'SUCCEEDED' },
      manifest: { schema: { columns: [{ name: 'n' }] } },
      result: { data_array: [['1']] },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => pending })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => succeeded });
    vi.stubGlobal('fetch', fetchMock);

    const promise = execSql('SELECT COUNT(*) AS n FROM x');
    await vi.advanceTimersByTimeAsync(1000);
    const rows = await promise;

    expect(rows).toEqual([{ n: '1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.cloud.databricks.com/api/2.0/sql/statements/stmt-3',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
    );
    vi.useRealTimers();
  });
});
