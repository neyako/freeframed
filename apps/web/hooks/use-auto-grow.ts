import * as React from "react";

/**
 * Grows a textarea with its text. Cap it with a CSS max-height; past the cap
 * it scrolls (give it overflow-y-auto).
 */
export function useAutoGrow(
  ref: React.RefObject<HTMLTextAreaElement>,
  value: string,
) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves out the border; border-box height needs it back
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [ref, value]);
}
