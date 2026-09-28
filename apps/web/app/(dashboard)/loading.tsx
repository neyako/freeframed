// Route-level fallback renders inside the dashboard layout (header stays), so
// this is just the content area: one static line, no skeleton chrome.
export default function DashboardLoading() {
  return <p className="px-4 py-6 text-[13px] text-text-tertiary">Loading…</p>
}
