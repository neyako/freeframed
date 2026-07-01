"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

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
    <button
      type="button"
      onClick={() => void handleCopy()}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-status-success" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

interface ControlRowProps {
  readonly icon: React.ComponentType<{ readonly className?: string }>;
  readonly label: string;
  readonly children: React.ReactNode;
  readonly description?: string;
  readonly footer?: React.ReactNode;
}

export function ControlRow({
  icon: Icon,
  label,
  children,
  description,
  footer,
}: ControlRowProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-secondary p-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-tertiary text-text-tertiary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">{label}</p>
            {description && (
              <p className="mt-0.5 text-xs leading-5 text-text-tertiary">
                {description}
              </p>
            )}
          </div>
          <div className="shrink-0">{children}</div>
        </div>
        {footer && <div className="mt-3">{footer}</div>}
      </div>
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
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-10 items-center rounded-full border border-border bg-bg-tertiary transition-colors hover:border-border-focus disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent"
      data-state={checked ? "checked" : "unchecked"}
    >
      <span
        className="block h-4 w-4 translate-x-1 rounded-full bg-text-tertiary transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-white"
        data-state={checked ? "checked" : "unchecked"}
      />
    </button>
  );
}
