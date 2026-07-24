// Per-navigation enter animation. Next.js remounts template.tsx on every
// route change within the group (unlike layout.tsx, which persists), so this
// fade replays on each visit. Opacity-only + fast, so it layers cleanly over
// the per-card `ff-stagger` rise instead of fighting it. SWR serves cached
// data on remount, so cached routes don't flash. Global reduced-motion guard
// zeroes the duration.
export default function DashboardTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="animate-in fade-in duration-200 ease-out">{children}</div>
  );
}
