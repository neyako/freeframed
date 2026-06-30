"use client";

import * as React from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SharePermission } from "@/types";

const SHARE_PERMISSIONS = ["view", "comment", "approve"] satisfies readonly SharePermission[];
const SHARE_PERMISSION_VALUES: readonly string[] = SHARE_PERMISSIONS;

function isSharePermission(value: string): value is SharePermission {
  return SHARE_PERMISSION_VALUES.includes(value);
}

interface PermissionSelectProps {
  readonly value: SharePermission;
  readonly onChange: (value: SharePermission) => void;
  readonly disabled?: boolean;
}

export function PermissionSelect({
  value,
  onChange,
  disabled,
}: PermissionSelectProps) {
  function handleValueChange(nextValue: string) {
    if (isSharePermission(nextValue)) onChange(nextValue);
  }

  return (
    <Select.Root
      value={value}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <Select.Trigger
        className={cn(
          "flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-bg-secondary px-3 text-sm text-text-primary",
          "focus:outline-none focus:border-border-focus",
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
          className="z-[200] min-w-[160px] overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-xl"
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport className="p-1">
            {SHARE_PERMISSIONS.map((permission) => (
              <Select.Item
                key={permission}
                value={permission}
                className="relative flex cursor-pointer select-none items-center rounded px-3 py-2 text-sm text-text-primary outline-none hover:bg-bg-hover data-[highlighted]:bg-bg-hover capitalize"
              >
                <Select.ItemText>{permission}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
