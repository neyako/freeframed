import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickShare } from "../quick-share";
import { api } from "@/lib/api";

interface MockUploadFile {
  readonly id: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly fileType: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly assetName: string;
  readonly progress: number;
  readonly processingProgress: number;
  readonly status: "complete" | "failed" | "processing" | "uploading";
  readonly error?: string;
  readonly assetId?: string;
  readonly createdAt: number;
}

interface MockStartUploadOptions {
  readonly source?: "quick-share";
}

const mocks = vi.hoisted(() => {
  const uploadState: { files: MockUploadFile[] } = { files: [] };
  return {
    uploadState,
    startUpload: vi.fn<
      (
        file: File,
        projectId: string,
        assetName: string,
        projectName?: string,
        folderId?: string | null,
        options?: MockStartUploadOptions,
      ) => string
    >(() => "upload-1"),
  };
});

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    readonly children: ReactNode;
    readonly href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("@/stores/upload-store", () => ({
  getUploadDisplayProgress: (upload: MockUploadFile) =>
    upload.status === "processing" ? upload.processingProgress : upload.progress,
  useUploadStore: () => ({
    files: mocks.uploadState.files,
    startUpload: mocks.startUpload,
  }),
}));

const mockedApi = vi.mocked(api);
const writeText = vi.fn<(text: string) => Promise<void>>();

function renderQuickShare() {
  const cache = new Map();
  function Ui() {
    return (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <QuickShare />
      </SWRConfig>
    );
  }

  const result = render(<Ui />);
  return {
    ...result,
    rerenderQuickShare: () => result.rerender(<Ui />),
  };
}

function quickShareProject() {
  return {
    id: "project-quick",
    name: "Quick Shares",
    description: null,
    created_by: "user-1",
    project_type: "personal",
    is_quick_share: true,
    created_at: "2026-07-07T00:00:00Z",
    deleted_at: null,
  };
}

function completedUpload(): MockUploadFile {
  return {
    id: "upload-1",
    fileName: "hero.mov",
    fileSize: 4,
    fileType: "video/quicktime",
    projectId: "project-quick",
    projectName: "Quick Shares",
    assetName: "hero.mov",
    progress: 100,
    processingProgress: 100,
    status: "complete",
    assetId: "asset-1",
    createdAt: 1783382400000,
  };
}

describe("QuickShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploadState.files = [];
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/assets/asset-1/shares") return [];
      return [];
    });
    mockedApi.post.mockImplementation(async (path: string) => {
      if (path === "/projects/quick-share") return quickShareProject();
      if (path === "/assets/asset-1/share") {
        return {
          id: "share-1",
          token: "token",
          title: "hero.mov",
          description: null,
          permission: "comment",
          is_enabled: true,
          allow_download: false,
          url: "https://app.test/share/token",
        };
      }
      return {};
    });
  });

  it("renders the drop zone", () => {
    renderQuickShare();

    expect(screen.getByText("Drop a video here")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Choose video" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Recent quick shares")).not.toBeInTheDocument();
  });

  it("posts to quick-share and starts an upload on file select", async () => {
    const user = userEvent.setup();
    renderQuickShare();

    const file = new File(["cut"], "hero.mov", { type: "video/quicktime" });
    await user.upload(screen.getByLabelText("Choose video"), file);

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith("/projects/quick-share");
    });
    expect(mocks.startUpload).toHaveBeenCalledWith(
      file,
      "project-quick",
      "hero.mov",
      "Quick Shares",
      null,
      { source: "quick-share" },
    );
  });

  it("shows a copyable link once the upload completes", async () => {
    const user = userEvent.setup();
    const view = renderQuickShare();
    const file = new File(["cut"], "hero.mov", { type: "video/quicktime" });

    await user.upload(screen.getByLabelText("Choose video"), file);
    await waitFor(() => {
      expect(mocks.startUpload).toHaveBeenCalledWith(
        file,
        "project-quick",
        "hero.mov",
        "Quick Shares",
        null,
        { source: "quick-share" },
      );
    });
    mocks.uploadState.files = [completedUpload()];
    view.rerenderQuickShare();

    expect(
      await screen.findByText("https://app.test/share/token"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open asset/i })).toHaveAttribute(
      "href",
      "/assets/asset-1",
    );

    await user.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(
      await screen.findByRole("button", { name: /^copied$/i }),
    ).toBeInTheDocument();
  });
});
