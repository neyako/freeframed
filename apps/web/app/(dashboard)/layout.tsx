"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useUploadStore } from "@/stores/upload-store";
import { Header } from "@/components/layout/header";
import { CommandPalette } from "@/components/layout/command-palette";
import { UploadsPanel } from "@/components/layout/uploads-panel";
import { UploadSSEBridge } from "@/components/layout/upload-sse-bridge";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [commandOpen, setCommandOpen] = React.useState(false);
  const { fetchUser } = useAuthStore();
  const { fetchHistory } = useUploadStore();

  // Hide header on asset viewer pages — the viewer has its own top bar
  const isAssetViewer = /\/projects\/[^/]+\/assets\/[^/]+/.test(pathname);

  React.useEffect(() => {
    fetchUser();
    fetchHistory();
  }, [fetchUser, fetchHistory]);

  // Global keyboard shortcut for command palette
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      <main className="flex flex-1 flex-col overflow-hidden">
        {!isAssetViewer && <Header onSearchOpen={() => setCommandOpen(true)} />}

        <div className="relative flex-1 overflow-y-auto">{children}</div>
      </main>

      <UploadsPanel />
      <UploadSSEBridge />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
