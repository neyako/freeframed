"use client";

import * as React from "react";
import { Check, Copy, Link2 } from "lucide-react";

import { PermissionSelect } from "./share-permission-select";
import type { ManagedShareLink, ShareLinkCandidate } from "./share-targets";

function getShareUrl(link: Pick<ShareLinkCandidate, "token" | "url">) {
  return (
    link.url ??
    `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.token}`
  );
}

function CopyButton({ text }: { readonly text: string }) {
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
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
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

interface LinkControlsProps {
  readonly link: ManagedShareLink;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onPatch: (
    updates: Partial<Pick<ManagedShareLink, "permission" | "allow_download">>,
  ) => void;
}

export function LinkControls({
  link,
  saving,
  error,
  onPatch,
}: LinkControlsProps) {
  const url = getShareUrl(link);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 shrink-0 text-text-tertiary" />
        <span className="text-sm font-medium text-text-primary">
          Anyone with the link
        </span>
        <div className="ml-auto">
          <PermissionSelect
            value={link.permission}
            onChange={(permission) => onPatch({ permission })}
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2">
        <span className="flex-1 truncate font-mono text-xs text-text-primary">
          {url}
        </span>
        <CopyButton text={url} />
      </div>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={link.allow_download}
          onChange={(event) => onPatch({ allow_download: event.target.checked })}
          disabled={saving}
          className="rounded border-border"
        />
        <span className="text-sm text-text-secondary">Allow download</span>
      </label>

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
