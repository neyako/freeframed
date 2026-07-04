"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function CopyButton({
  text,
  disabled,
}: { readonly text: string; readonly disabled: boolean }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      if (err instanceof Error) return;
      throw err;
    }
  }

  return (
    <Button
      type="button"
      variant="solid"
      size="md"
      onClick={() => void handleCopy()}
      disabled={disabled}
      className="min-w-[92px]"
      title="Copy to clipboard"
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

interface ControlRowProps {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly group?: boolean;
  readonly footer?: React.ReactNode;
}

export function ControlRow({
  label,
  children,
  group = false,
  footer,
}: ControlRowProps) {
  return (
    <div>
      <div
        className={cn(
          "flex items-center justify-between gap-4 border-b px-5 py-3.5",
          group ? "border-border" : "border-border-secondary",
        )}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{label}</p>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
      {footer && <div className="px-5 pb-4">{footer}</div>}
    </div>
  );
}

interface SwitchControlProps {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function SwitchControl({
  label,
  checked,
  disabled,
  onChange,
}: SwitchControlProps) {
  return (
    <Switch
      aria-label={label}
      size="sm"
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  );
}
