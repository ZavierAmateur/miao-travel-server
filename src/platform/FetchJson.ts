import { PlatformAuthError, PlatformAuthErrorCode } from "./PlatformAuthError.js";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function fetchJson(
  fetcher: FetchLike,
  url: URL,
  timeoutMs = 5_000,
): Promise<unknown> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new PlatformAuthError(
        PlatformAuthErrorCode.Unavailable,
        `平台认证服务返回 HTTP ${response.status}`,
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof PlatformAuthError) throw error;
    throw new PlatformAuthError(PlatformAuthErrorCode.Unavailable, "平台认证服务暂时不可用");
  }
}
