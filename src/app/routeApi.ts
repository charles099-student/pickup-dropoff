export const MOCK_API_BASE_URL = 'https://sg-mock-api.lalamove.com';
export const ROUTE_POLL_INTERVAL_MS = 1500;
export const ROUTE_POLL_TIMEOUT_MS = 30000;

export type RouteSuccessResponse = {
  status: 'success';
  path: [string, string][];
  total_distance: number;
  total_time: number;
};

export type RouteInProgressResponse = {
  status: 'in progress';
};

export type RouteFailureResponse = {
  status: 'failure';
  error: string;
};

export type RouteResponse = RouteSuccessResponse | RouteInProgressResponse | RouteFailureResponse;

type SubmitRouteResponse = {
  token?: string;
};

export type RouteRequestOptions = {
  baseUrl?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  signal?: AbortSignal;
};

function shouldRetryRouteLookup(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request aborted', 'AbortError'));
      return;
    }

    const timeoutId = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException('Request aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function parseRoutePath(path: [string, string][]) {
  const points = path.map(([lat, lng]) => ({
    lat: Number(lat),
    lng: Number(lng),
  }));

  if (points.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lng))) {
    throw new Error('The backend returned invalid waypoint coordinates.');
  }

  return points;
}

async function fetchRouteResult(
  token: string,
  {
    baseUrl = MOCK_API_BASE_URL,
    pollIntervalMs = ROUTE_POLL_INTERVAL_MS,
    pollTimeoutMs = ROUTE_POLL_TIMEOUT_MS,
    signal,
  }: RouteRequestOptions,
  onInProgress?: () => void,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const response = await fetch(`${baseUrl}/route/${encodeURIComponent(token)}`, { signal });

    if (!response.ok) {
      if (shouldRetryRouteLookup(response.status)) {
        onInProgress?.();
        await delay(pollIntervalMs, signal);
        continue;
      }

      throw new Error(`Route lookup failed with HTTP ${response.status}.`);
    }

    const route = (await response.json()) as RouteResponse;

    if (route.status === 'success') {
      return route;
    }

    if (route.status === 'failure') {
      throw new Error(route.error || 'The backend could not calculate a route.');
    }

    if (route.status !== 'in progress') {
      throw new Error('The backend returned an unknown route status.');
    }

    onInProgress?.();
    await delay(pollIntervalMs, signal);
  }

  throw new Error('Route calculation timed out. Please try again.');
}

export async function requestRoute(
  origin: string,
  destination: string,
  options: RouteRequestOptions = {},
  onInProgress?: () => void,
) {
  const baseUrl = options.baseUrl ?? MOCK_API_BASE_URL;

  const submitResponse = await fetch(`${baseUrl}/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ origin, destination }),
    signal: options.signal,
  });

  if (!submitResponse.ok) {
    throw new Error(`Route request failed with HTTP ${submitResponse.status}.`);
  }

  const submitResult = (await submitResponse.json()) as SubmitRouteResponse;

  if (!submitResult.token) {
    throw new Error('The backend did not return a route token.');
  }

  return fetchRouteResult(submitResult.token, options, onInProgress);
}
