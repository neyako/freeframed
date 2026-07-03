"use client";

import * as React from "react";
import { Link2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Segmented } from "@/components/ui/segmented";
import type { SharePermission } from "@/types";
import {
  ControlRow,
  CopyButton,
  SwitchControl,
} from "./share-link-control-primitives";
import type {
  ManagedShareLink,
  ShareLinkCandidate,
  ShareLinkPatch,
} from "./share-targets";
import { VisibilitySelect } from "./share-visibility-select";

const SHARE_PERMISSION_OPTIONS = [
  { value: "view", label: "View" },
  { value: "comment", label: "Comment" },
  { value: "approve", label: "Approve" },
] satisfies readonly {
  readonly value: SharePermission;
  readonly label: string;
}[];
const SHARE_PERMISSION_VALUES: readonly string[] = SHARE_PERMISSION_OPTIONS.map(
  (option) => option.value,
);

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

function isSharePermission(value: string): value is SharePermission {
  return SHARE_PERMISSION_VALUES.includes(value);
}

interface LinkControlsProps {
  readonly link: ManagedShareLink;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onPatch: (updates: ShareLinkPatch) => void;
  readonly onRevoke?: () => void;
  readonly showAdvancedControls?: boolean;
  readonly beforeFooter?: React.ReactNode;
}

export function LinkControls({
  link,
  saving,
  error,
  onPatch,
  onRevoke,
  showAdvancedControls = false,
  beforeFooter,
}: LinkControlsProps) {
  const [passphraseEnabled, setPassphraseEnabled] = React.useState(
    Boolean(link.has_password),
  );
  const [passphrase, setPassphrase] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const url = getShareUrl(link);
  const visibility = link.visibility ?? "public";
  const permission = isSharePermission(link.permission) ? link.permission : null;

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
    <div>
      <div className="flex items-center gap-2 border-b border-border px-5 py-[18px]">
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded border border-border bg-bg-primary px-3">
          <Link2 className="h-4 w-4 shrink-0 text-text-secondary" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">
            {url}
          </span>
        </div>
        <CopyButton text={url} disabled={saving} />
      </div>

      <ControlRow label="Access" labelVi="Quyền truy cập" group>
        {permission ? (
          <Segmented
            options={SHARE_PERMISSION_OPTIONS}
            value={permission}
            onChange={(nextPermission) => {
              if (!saving) onPatch({ permission: nextPermission });
            }}
            className={saving ? "pointer-events-none opacity-50" : undefined}
          />
        ) : (
          <span className="select-none font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary">
            {link.permission}
          </span>
        )}
      </ControlRow>

      {showAdvancedControls && (
        <ControlRow label="Visibility" labelVi="Ai có thể mở liên kết">
          <VisibilitySelect
            value={visibility}
            onChange={(nextVisibility) => onPatch({ visibility: nextVisibility })}
            disabled={saving}
          />
        </ControlRow>
      )}

      <ControlRow label="Allow download" labelVi="Cho phép tải xuống">
        <SwitchControl
          label="Allow download"
          checked={link.allow_download}
          disabled={saving}
          onChange={(allowDownload) => onPatch({ allow_download: allowDownload })}
        />
      </ControlRow>

      {showAdvancedControls && (
        <ControlRow
          label="Passphrase"
          labelVi="Yêu cầu mật khẩu khi mở"
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
                placeholder="Nhập mật khẩu · passphrase"
                className="h-[38px] w-full rounded border border-border-strong bg-bg-primary px-3 font-mono text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
        <ControlRow label="Watermark" labelVi="Đóng dấu bản xem">
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

      {showAdvancedControls && (
        <ControlRow label="Expiration" labelVi="Ngày hết hạn" group>
          <input
            type="date"
            aria-label="Expiration date"
            value={formatDateInput(link.expires_at)}
            onChange={(event) =>
              onPatch({ expires_at: toExpirationValue(event.target.value) })
            }
            disabled={saving}
            className="h-[38px] rounded border border-border-strong bg-bg-primary px-3 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </ControlRow>
      )}

      {error && <p className="px-5 py-3 text-xs text-status-error">{error}</p>}

      {beforeFooter}

      {showAdvancedControls && onRevoke && (
        <div className="flex items-center justify-between gap-4 px-5 py-[15px]">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">Revoke link</p>
            <p className="mt-0.5 text-xs text-text-secondary">
              Vô hiệu hóa liên kết ngay lập tức
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={saving}
            className="inline-flex h-[34px] items-center rounded border border-accent-line bg-transparent px-3.5 font-mono text-[11px] uppercase tracking-[0.08em] text-accent transition-colors hover:border-accent hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Revoke
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
        </div>
      )}
    </div>
  );
}
