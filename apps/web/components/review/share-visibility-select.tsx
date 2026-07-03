"use client";

import * as React from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ShareVisibility } from "./share-targets";

const SHARE_VISIBILITIES = ["public", "secure"] satisfies readonly ShareVisibility[];
const SHARE_VISIBILITY_VALUES: readonly string[] = SHARE_VISIBILITIES;
const SHARE_VISIBILITY_LABELS: Record<ShareVisibility, string> = {
  public: "Anyone with the link",
  secure: "Signed-in users only",
};

function isShareVisibility(value: string): value is ShareVisibility {
  return SHARE_VISIBILITY_VALUES.includes(value);
}

interface VisibilitySelectProps {
  readonly value: ShareVisibility;
  readonly onChange: (value: ShareVisibility) => void;
  readonly disabled?: boolean;
}

export function VisibilitySelect({
  value,
  onChange,
  disabled,
}: VisibilitySelectProps) {
  function handleValueChange(nextValue: string) {
    if (isShareVisibility(nextValue)) onChange(nextValue);
  }

  return (
    <Select.Root
      value={value}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <Select.Trigger
        className={cn(
          "flex h-[38px] items-center justify-between gap-2 rounded border border-border-strong bg-bg-primary px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary",
          "focus:outline-none focus:border-accent",
          "data-[placeholder]:text-text-tertiary disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown className="h-4 w-4 text-text-tertiary" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="z-[200] min-w-[180px] overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-xl"
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport className="p-1">
            {SHARE_VISIBILITIES.map((visibility) => (
              <Select.Item
                key={visibility}
                value={visibility}
                className="relative flex cursor-pointer select-none items-center rounded px-3 py-2 text-sm text-text-primary outline-none hover:bg-bg-hover data-[highlighted]:bg-bg-hover"
              >
                <Select.ItemText>
                  {SHARE_VISIBILITY_LABELS[visibility]}
                </Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
