import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareReviewScreen } from "../folder-share-viewer";

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  refetchComments: vi.fn<() => Promise<void>>(),
}));

const currentVersion = {
  id: "version-1",
  asset_id: "asset-1",
  version_number: 1,
  processing_status: "ready" as const,
  created_by: "uploader-1",
  created_at: "2026-07-13T00:00:00Z",
  deleted_at: null,
  files: [],
};

vi.mock("@/components/review/review-provider", () => ({
  ReviewProvider: ({ children }: { readonly children: ReactNode }) => children,
  useReview: () => ({
    asset: {
      id: "asset-1",
      name: "Still.png",
      asset_type: "image",
    },
    versions: [currentVersion],
    isLoading: false,
    comments: [],
    refetchComments: mocks.refetchComments,
    addComment: mocks.addComment,
  }),
}));

vi.mock("@/stores/review-store", () => ({
  useReviewStore: () => ({
    currentVersion,
    isDrawingMode: false,
    focusedCommentId: null,
  }),
}));

vi.mock("@/hooks/use-comments", () => ({ useComments: () => ({}) }));
// Preset identity so the viewer doesn't fetch /auth/me through the fetch stub
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { user: { id: string }; fetchUser: () => Promise<void> }) => unknown) =>
    selector({ user: { id: "user-1" }, fetchUser: async () => {} }),
}));
vi.mock("@/components/review/video-player", () => ({ VideoPlayer: () => null }));
vi.mock("@/components/review/image-viewer", () => ({
  ImageViewer: () => <div>Image viewer</div>,
}));
vi.mock("@/components/review/audio-player", () => ({ AudioPlayer: () => null }));
vi.mock("@/components/review/comment-panel", () => ({ CommentPanel: () => null }));
vi.mock("@/components/review/comment-input", () => ({
  CommentInput: ({ onSubmit, visibilityLocked }: {
    readonly onSubmit: (body: string) => Promise<void>;
    readonly visibilityLocked?: boolean;
  }) => (
    <button
      type="button"
      data-visibility-locked={visibilityLocked ? "true" : "false"}
      onClick={() => void onSubmit("Looks good")}
    >
      Submit comment
    </button>
  ),
}));
vi.mock("@/components/review/annotation-overlay", () => ({ AnnotationOverlay: () => null }));
vi.mock("@/components/review/annotation-canvas", () => ({ AnnotationCanvas: () => null }));

describe("ShareReviewScreen identity", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetchComments.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes("min-width: 768px"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("submits through the share endpoint without guest fields when viewerName is set", async () => {
    mocks.addComment.mockResolvedValue({ id: "comment-1" });
    render(
      <ShareReviewScreen
        token="token"
        assetId="asset-1"
        assetName="Still.png"
        viewerName="Pat Reviewer"
        permission="comment"
        allowDownload={false}
      />,
    );

    const submitButton = await screen.findByRole("button", { name: "Submit comment" });
    expect(submitButton).toHaveAttribute("data-visibility-locked", "true");
    fireEvent.click(submitButton);

    await waitFor(() => expect(mocks.addComment).toHaveBeenCalledOnce());
    expect(screen.queryByText("Leave a comment")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    const payload = mocks.addComment.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ body: "Looks good", version_id: "version-1" });
    expect(payload).not.toHaveProperty("guest_name");
    expect(payload).not.toHaveProperty("guest_email");
  });

  it("keeps the guest identity prompt for anonymous viewers", async () => {
    render(
      <ShareReviewScreen
        token="token"
        assetId="asset-1"
        assetName="Still.png"
        viewerName={null}
        permission="comment"
        allowDownload={false}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Submit comment" }));

    expect(await screen.findByText("Leave a comment")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.addComment).not.toHaveBeenCalled();
  });
});
