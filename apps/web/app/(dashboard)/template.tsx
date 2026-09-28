export default function DashboardTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // flex + min-h-full: pages that style themselves full-height (review
    // chrome) resolve their own h-full against a definite parent; short pages
    // still fill the viewport so full-height sidebars don't crop at content
    // height. Taller-than-viewport content grows it.
    <div className="flex min-h-full flex-col">{children}</div>
  );
}
