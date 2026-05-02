import type {
  DimMemberCreateRequest,
  DimMemberDeleteResponse,
  DimMemberMutationResponse,
  DimMembersResponse,
  DimMemberUpdateRequest,
  DriverDefineRequest,
  DriverDefineResponse,
  DriverDeleteResponse,
  DriverListResponse,
  ScenarioCopyRequest,
  ScenarioCopyResponse,
  SliceRequest,
  SliceResponse,
  SubmitRequest,
  SubmitResponse,
} from "../types/generated";
import type { DimName } from "../types/dims";

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

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`PATCH ${path} failed: ${r.status} ${r.statusText} ${text}`);
  }
  return (await r.json()) as T;
}

async function deleteJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`DELETE ${path} failed: ${r.status} ${r.statusText} ${text}`);
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

// --- Slice 9 dim CRUD + driver lifecycle -----------------------------

export function addDimMember(
  dim: DimName,
  req: DimMemberCreateRequest,
): Promise<DimMemberMutationResponse> {
  return postJson<DimMemberMutationResponse>(`/dimensions/${dim}/members`, req);
}

export function updateDimMember(
  dim: DimName,
  id: string,
  req: DimMemberUpdateRequest,
): Promise<DimMemberMutationResponse> {
  return patchJson<DimMemberMutationResponse>(
    `/dimensions/${dim}/members/${encodeURIComponent(id)}`,
    req,
  );
}

export function deleteDimMember(
  dim: DimName,
  id: string,
  requestId: string,
): Promise<DimMemberDeleteResponse> {
  const qs = new URLSearchParams({ request_id: requestId }).toString();
  return deleteJson<DimMemberDeleteResponse>(
    `/dimensions/${dim}/members/${encodeURIComponent(id)}?${qs}`,
  );
}

export function deleteDriver(
  account: string,
  requestId: string,
): Promise<DriverDeleteResponse> {
  const qs = new URLSearchParams({ request_id: requestId }).toString();
  return deleteJson<DriverDeleteResponse>(
    `/drivers/${encodeURIComponent(account)}?${qs}`,
  );
}

// --- helpers ---------------------------------------------------------

export function newRequestId(): string {
  // crypto.randomUUID is available in Edge WebView used by Excel.
  return crypto.randomUUID();
}
