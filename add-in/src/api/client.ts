import type {
  DimMembersResponse,
  DimName,
  DriverDefineRequest,
  DriverDefineResponse,
  DriverListResponse,
  ScenarioCopyRequest,
  ScenarioCopyResponse,
  SliceRequest,
  SliceResponse,
  SubmitRequest,
  SubmitResponse,
} from "../types/generated";

// Vite proxies /api/* to the backend at http://127.0.0.1:8000 so the Excel WebView
// (which serves the add-in over HTTPS) doesn't refuse a mixed-content fetch.
const API_BASE = "/api";

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${r.status} ${r.statusText} ${text}`);
  }
  return (await r.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${r.status} ${r.statusText} ${text}`);
  }
  return (await r.json()) as T;
}

// --- read endpoints --------------------------------------------------

export function fetchSlice(req: SliceRequest): Promise<SliceResponse> {
  return postJson<SliceResponse>("/slice", req);
}

export function fetchDimMembers(dim: DimName): Promise<DimMembersResponse> {
  return getJson<DimMembersResponse>(`/dimensions/${dim}/members`);
}

export function fetchDrivers(): Promise<DriverListResponse> {
  return getJson<DriverListResponse>("/drivers");
}

// --- write endpoints -------------------------------------------------

export function submitDeltas(req: SubmitRequest): Promise<SubmitResponse> {
  return postJson<SubmitResponse>("/submit", req);
}

export function copyScenario(req: ScenarioCopyRequest): Promise<ScenarioCopyResponse> {
  return postJson<ScenarioCopyResponse>("/scenarios/copy", req);
}

export function defineDriver(req: DriverDefineRequest): Promise<DriverDefineResponse> {
  return postJson<DriverDefineResponse>("/drivers/define", req);
}

// --- helpers ---------------------------------------------------------

export function newRequestId(): string {
  // crypto.randomUUID is available in Edge WebView used by Excel.
  return crypto.randomUUID();
}
