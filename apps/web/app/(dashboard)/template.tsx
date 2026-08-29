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
    // flex + min-h-full: pages that style themselves full-height (settings
    // shell, review chrome) resolve their own h-full against a definite
    // parent; short pages still fill the viewport so full-height sidebars
    // don't crop at content height. taller-than-viewport content grows it.
    <div className="flex min-h-full flex-col animate-in fade-in duration-200 ease-out">
      {children}
    </div>
  );
}
