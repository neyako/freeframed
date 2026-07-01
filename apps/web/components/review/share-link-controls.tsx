"use client";

import * as React from "react";
import {
  Calendar,
  Check,
  Copy,
  Download,
  Eye,
  Link2,
  LockKeyhole,
  Shield,
  Stamp,
  Trash2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PermissionSelect } from "./share-permission-select";
import type {
  ManagedShareLink,
  ShareLinkCandidate,
  ShareLinkPatch,
} from "./share-targets";
import { VisibilitySelect } from "./share-visibility-select";

function getShareUrl(link: Pick<ShareLinkCandidate, "token" | "url">) {
  return (
    link.url ??
    `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.token}`
  );
}

function formatDateInput(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

function toExpirationValue(value: string) {
  if (!value) return null;
  return new Date(`${value}T23:59:59.000Z`).toISOString();
}

function CopyButton({
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

function ControlRow({
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

function SwitchControl({
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

interface LinkControlsProps {
  readonly link: ManagedShareLink;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onPatch: (updates: ShareLinkPatch) => void;
  readonly onRevoke?: () => void;
  readonly showAdvancedControls?: boolean;
}

export function LinkControls({
  link,
  saving,
  error,
  onPatch,
  onRevoke,
  showAdvancedControls = false,
}: LinkControlsProps) {
  const [passphraseEnabled, setPassphraseEnabled] = React.useState(
    Boolean(link.has_password),
  );
  const [passphrase, setPassphrase] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const url = getShareUrl(link);
  const visibility = link.visibility ?? "public";

  React.useEffect(() => {
    setPassphraseEnabled(Boolean(link.has_password));
    setPassphrase("");
  }, [link.has_password, link.token]);

  function handlePassphraseToggle(checked: boolean) {
    setPassphraseEnabled(checked);
    if (!checked) {
      setPassphrase("");
      onPatch({ password: "" });
    }
  }

  function handlePassphraseBlur() {
    const nextPassphrase = passphrase.trim();
    if (nextPassphrase) onPatch({ password: nextPassphrase });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-bg-tertiary p-2">
        <div className="flex items-center gap-2 rounded-md bg-bg-secondary px-3 py-2">
          <Link2 className="h-4 w-4 shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
            {url}
          </span>
          <CopyButton text={url} disabled={saving} />
        </div>
      </div>

      <ControlRow icon={Shield} label="Access">
        <PermissionSelect
          value={link.permission}
          onChange={(permission) => onPatch({ permission })}
          disabled={saving}
        />
      </ControlRow>

      {showAdvancedControls && (
        <ControlRow icon={Eye} label="Visibility">
          <VisibilitySelect
            value={visibility}
            onChange={(nextVisibility) => onPatch({ visibility: nextVisibility })}
            disabled={saving}
          />
        </ControlRow>
      )}

      <ControlRow icon={Download} label="Allow download">
        <SwitchControl
          label="Allow download"
          checked={link.allow_download}
          disabled={saving}
          onChange={(allowDownload) => onPatch({ allow_download: allowDownload })}
        />
      </ControlRow>

      {showAdvancedControls && (
        <ControlRow
          icon={LockKeyhole}
          label="Passphrase"
          description="Require a passphrase before opening this link."
          footer={
            passphraseEnabled ? (
              <input
                type="password"
                aria-label="Link passphrase"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                onBlur={handlePassphraseBlur}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                disabled={saving}
                placeholder={
                  link.has_password
                    ? "Enter a new passphrase"
                    : "Set passphrase"
                }
                className="h-9 w-full rounded-md border border-border bg-bg-tertiary px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
            ) : null
          }
        >
          <SwitchControl
            label="Passphrase"
            checked={passphraseEnabled}
            disabled={saving}
            onChange={handlePassphraseToggle}
          />
        </ControlRow>
      )}

      {showAdvancedControls && (
        <ControlRow icon={Calendar} label="Expiration">
          <input
            type="date"
            aria-label="Expiration date"
            value={formatDateInput(link.expires_at)}
            onChange={(event) =>
              onPatch({ expires_at: toExpirationValue(event.target.value) })
            }
            disabled={saving}
            className="h-9 rounded-md border border-border bg-bg-secondary px-3 text-sm text-text-primary focus:border-border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </ControlRow>
      )}

      {showAdvancedControls && (
        <ControlRow icon={Stamp} label="Watermark">
          <SwitchControl
            label="Watermark"
            checked={Boolean(link.show_watermark)}
            disabled={saving}
            onChange={(showWatermark) =>
              onPatch({ show_watermark: showWatermark })
            }
          />
        </ControlRow>
      )}

      {showAdvancedControls && onRevoke && (
        <ControlRow
          icon={Trash2}
          label="Revoke link"
          description="Disable this link immediately."
        >
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-status-error/40 px-3 text-sm font-medium text-status-error transition-colors hover:bg-status-error/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Revoke link
          </button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Revoke share link?"
            description="Anyone using this link will lose access until you create a new share link."
            confirmLabel="Revoke link"
            variant="danger"
            loading={saving}
            onConfirm={onRevoke}
          />
        </ControlRow>
      )}

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
