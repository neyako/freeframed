import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BulkSharePanel, ShareDialog, SharePanel } from "../share-dialog";
import { api } from "@/lib/api";
import {
  assetShareListItem,
  bulkShareLink,
  createdShareLink,
  directShare,
  folderShareLink,
  legacyProjectShareDetails,
  legacyProjectShareListItem,
  projectShareDetails,
  projectShareListItem,
} from "./share-dialog.fixtures";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

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

  it("creates a folder single-link panel with folder people-share endpoints", async () => {
    const link = folderShareLink();

    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/folders/folder-1/shares") return [];
      if (path === "/folders/folder-1/direct-shares") return [];
      if (path === "/organizations/project-1/teams") return { teams: [] };
      return [];
    });
    mockedApi.post.mockImplementation(async (path: string) => {
      if (path === "/folders/folder-1/share") return link;
      return {};
    });

    render(
      <SharePanel
        target={{ kind: "folder", id: "folder-1" }}
        projectId="project-1"
        withPeople
      />,
    );

    expect(await screen.findByText("Anyone with the link")).toBeInTheDocument();
    expect(screen.getByText(/\/share\/folder-token$/)).toBeInTheDocument();
    expect(screen.getByText(/share with people/i)).toBeInTheDocument();

    expect(mockedApi.get).toHaveBeenCalledWith("/folders/folder-1/shares");
    expect(mockedApi.get).toHaveBeenCalledWith("/folders/folder-1/direct-shares");
    expect(mockedApi.post).toHaveBeenCalledWith("/folders/folder-1/share", {
      permission: "view",
      allow_download: false,
    });
  });

  it("hydrates the project root link from mixed project share list items", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/projects/project-1/share-links?search=Launch%20Film") {
        return [assetShareListItem(), projectShareListItem()];
      }
      if (path === "/share/asset-token/details") {
        return {
          ...createdShareLink(),
          token: "asset-token",
          asset_id: "asset-1",
          folder_id: null,
          project_id: null,
        };
      }
      if (path === "/share/project-token/details") return projectShareDetails();
      return [];
    });

    render(
      <SharePanel
        target={{ kind: "project", id: "project-1", name: "Launch Film" }}
        projectId="project-1"
        withPeople={false}
      />,
    );

    expect(await screen.findByText("Anyone with the link")).toBeInTheDocument();
    expect(screen.getByText(/\/share\/project-token$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/allow download/i)).toBeChecked();
    expect(screen.queryByText(/share with people/i)).not.toBeInTheDocument();

    expect(mockedApi.get).toHaveBeenCalledWith(
      "/projects/project-1/share-links?search=Launch%20Film",
    );
    expect(mockedApi.get).toHaveBeenCalledWith("/share/asset-token/details");
    expect(mockedApi.get).toHaveBeenCalledWith("/share/project-token/details");
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("reuses a legacy-titled project root link after search misses it", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/projects/project-1/share-links?search=Launch%20Film") {
        return [assetShareListItem()];
      }
      if (path === "/projects/project-1/share-links") {
        return [assetShareListItem(), legacyProjectShareListItem()];
      }
      if (path === "/share/asset-token/details") {
        return {
          ...createdShareLink(),
          token: "asset-token",
          asset_id: "asset-1",
          folder_id: null,
          project_id: null,
        };
      }
      if (path === "/share/project-token/details") {
        return legacyProjectShareDetails();
      }
      return [];
    });

    render(
      <SharePanel
        target={{ kind: "project", id: "project-1", name: "Launch Film" }}
        projectId="project-1"
        withPeople={false}
      />,
    );

    expect(await screen.findByText("Anyone with the link")).toBeInTheDocument();
    expect(screen.getByText(/\/share\/project-token$/)).toBeInTheDocument();

    expect(mockedApi.get).toHaveBeenCalledWith(
      "/projects/project-1/share-links?search=Launch%20Film",
    );
    expect(mockedApi.get).toHaveBeenCalledWith("/projects/project-1/share-links");
    expect(mockedApi.get).toHaveBeenCalledWith("/share/project-token/details");
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("creates one bulk share link and patches returned link settings", async () => {
    const user = userEvent.setup();
    const link = bulkShareLink();
    const bulkSharePath = "/projects/project-1/share/multi";

    mockedApi.post.mockResolvedValue(link);
    mockedApi.patch.mockResolvedValue({ ...link, allow_download: true });

    render(
      <BulkSharePanel
        projectId="project-1"
        assetIds={["asset-1"]}
        folderIds={["folder-1"]}
        title="Share 2 items"
      />,
    );

    expect(await screen.findByText("Anyone with the link")).toBeInTheDocument();
    expect(screen.getByText(/\/share\/bulk-token$/)).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledTimes(1);
    });
    expect(mockedApi.post).toHaveBeenCalledWith(bulkSharePath, {
      asset_ids: ["asset-1"],
      folder_ids: ["folder-1"],
      title: "Share 2 items",
      permission: "view",
      allow_download: false,
    });

    await user.click(screen.getByLabelText(/allow download/i));

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith("/share/bulk-token", {
        allow_download: true,
      });
    });
  });

  it("does not create a bulk link when no items are selected", async () => {
    render(
      <BulkSharePanel
        projectId="project-1"
        assetIds={[]}
        folderIds={[]}
        title="Empty selection"
      />,
    );

    expect(screen.getByText(/no items selected/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedApi.post).not.toHaveBeenCalled();
    });
  });
});
