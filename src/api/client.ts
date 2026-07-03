import { UsageEventsResponse, UsageSummary } from './types';

const BASE_URL = 'https://cursor.com';

export class CursorApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CursorApiError';
  }
}

export class CursorUsageClient {
  constructor(private readonly token: string) {}

  private headers(isPost: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Cookie: `WorkosCursorSessionToken=${this.token}`,
      Accept: 'application/json',
    };
    if (isPost) {
      headers['Content-Type'] = 'application/json';
      headers.Origin = 'https://cursor.com';
    }
    return headers;
  }

  async getUsageSummary(): Promise<UsageSummary> {
    const res = await fetch(`${BASE_URL}/api/usage-summary`, {
      headers: this.headers(false),
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new CursorApiError('not_authenticated', 401);
      }
      throw new CursorApiError(`Failed to fetch usage summary: ${res.status}`, res.status);
    }
    return (await res.json()) as UsageSummary;
  }

  async getFilteredUsageEvents(
    body: Record<string, unknown>,
  ): Promise<UsageEventsResponse> {
    const res = await fetch(`${BASE_URL}/api/dashboard/get-filtered-usage-events`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new CursorApiError('not_authenticated', 401);
      }
      throw new CursorApiError(`Failed to fetch usage events: ${res.status}`, res.status);
    }
    return (await res.json()) as UsageEventsResponse;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
