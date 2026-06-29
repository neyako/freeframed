import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareDialog } from "../share-dialog";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

function createdShareLink() {
  return {
    id: "link-1",
    token: "token",
    title: "Hero.mov",
    description: null,
    share_type: "asset",
    target_name: "Hero.mov",
    asset_id: "asset-1",
    folder_id: null,
    project_id: "project-1",
    permission: "comment",
    expires_at: null,
    allow_download: false,
    show_versions: true,
    is_enabled: true,
    appearance: null,
    created_by: "user-1",
    created_at: "2026-06-29T00:00:00Z",
    deleted_at: null,
    has_password: false,
    password_value: null,
  } as const;
}

function directShare() {
  return {
    id: "direct-share-1",
    asset_id: "asset-1",
    folder_id: null,
    shared_with_user_id: "user-12345678",
    shared_with_team_id: null,
    permission: "view",
    created_at: "2026-06-29T00:00:00Z",
  } as const;
}

describe("ShareDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.setPointerCapture ??= vi.fn();
    Element.prototype.releasePointerCapture ??= vi.fn();
    Element.prototype.scrollIntoView ??= vi.fn();
  });

  it("creates and edits one asset share link when no link exists", async () => {
    const user = userEvent.setup();
    const link = createdShareLink();
    const share = directShare();

    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/assets/asset-1/shares") return [];
      if (path === "/assets/asset-1/direct-shares") return [share];
      if (path === "/organizations/project-1/teams") return { teams: [] };
      return [];
    });
    mockedApi.post.mockImplementation(async (path: string) => {
      if (path === "/assets/asset-1/share") return link;
      return {};
    });
    mockedApi.patch.mockResolvedValue({ ...link, permission: "view" });

    render(
      <ShareDialog
        assetId="asset-1"
        projectId="project-1"
        assetName="Hero.mov"
      />,
    );

    await user.click(screen.getByRole("button", { name: /share/i }));

    expect(
      screen.queryByRole("button", { name: /new share link/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/add to existing share links/i)).not.toBeInTheDocument();

    expect(await screen.findByText("Anyone with the link")).toBeInTheDocument();
    expect(screen.getByText(/\/share\/token$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/allow download/i)).not.toBeChecked();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(screen.getByText(/share with user/i)).toBeInTheDocument();

    expect(mockedApi.get).toHaveBeenCalledWith("/assets/asset-1/shares");
    expect(mockedApi.get).toHaveBeenCalledWith("/assets/asset-1/direct-shares");
    expect(mockedApi.post).toHaveBeenCalledWith("/assets/asset-1/share", {
      permission: "comment",
      allow_download: false,
    });

    const linkControls = screen.getByText("Anyone with the link").closest("div");
    expect(linkControls).not.toBeNull();
    await user.click(within(linkControls as HTMLElement).getByRole("combobox"));
    const option = await screen.findByRole("option", { name: "view" });
    await user.click(option);

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith("/share/token", {
        permission: "view",
      });
    });

    const userShare = screen.getByText(/share with user/i).closest("div");
    expect(userShare).not.toBeNull();
    expect(
      within(userShare as HTMLElement).getByPlaceholderText("user@example.com"),
    ).toBeInTheDocument();
  });
});
