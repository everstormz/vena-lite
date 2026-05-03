// Excel custom function entry point. Static plain-JS file served by Vite at
// /functions.js (no transpilation needed). The id ("LOOKUP") must match
// `id` in functions.json. Namespace ("VENA") comes from manifest.xml. So
// users type =VENA.LOOKUP(account, entity, costcenter, period, scenario, version).
//
// Called by Excel's custom-functions runtime, which has its own JS context
// separate from the taskpane. To force =VENA.LOOKUP cells to re-fetch after
// a successful Submit/Override/Release, the taskpane calls
// workbook.application.calculate("Full").

async function LOOKUP(account, entity, costcenter, period, scenario, version) {
  // Surface failure modes as cell strings rather than throwing — Excel turns
  // thrown errors into an opaque #VALUE!, which is hard to debug in dev.
  try {
    const params = new URLSearchParams({
      account: String(account || ""),
      entity: String(entity || ""),
      costcenter: String(costcenter || ""),
      period: String(period || ""),
      scenario: String(scenario || ""),
      version: String(version || ""),
    });
    // Absolute URL — Excel's custom-functions runtime is a Web Worker that
    // doesn't inherit the page's origin for relative path resolution, so
    // `/api/...` resolves to the worker's blob: URL and fails with "Network
    // request failed". The Vite dev server is hardcoded to port 3000.
    const url = "https://localhost:3000/api/value?" + params.toString();
    const r = await fetch(url);
    if (r.status === 404) return "#N/A";
    if (!r.ok) {
      const text = await r.text().catch(function () { return ""; });
      return "VENA HTTP " + r.status + ": " + text.slice(0, 80);
    }
    const body = await r.json();
    if (body && typeof body.value === "string") return body.value;
    return "VENA bad payload: " + JSON.stringify(body).slice(0, 80);
  } catch (e) {
    return "VENA exc: " + (e && e.message ? e.message : String(e));
  }
}

// eslint-disable-next-line no-undef
CustomFunctions.associate("LOOKUP", LOOKUP);
