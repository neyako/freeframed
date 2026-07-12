import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareDialog } from "../share-dialog";
import { api } from "@/lib/api";
import { createdShareLink } from "./share-dialog.fixtures";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

describe("ShareDialog dropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.setPointerCapture ??= vi.fn();
    Element.prototype.releasePointerCapture ??= vi.fn();
    Element.prototype.scrollIntoView ??= vi.fn();
  });

  it("keeps the dropdown mounted long enough to confirm revoke", async () => {
    const user = userEvent.setup();
    const link = createdShareLink();

    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/assets/asset-1/shares") return [link];
      if (path === "/assets/asset-1/direct-shares") return [];
      return [];
    });
    mockedApi.delete.mockResolvedValue(undefined);

    render(
      <ShareDialog
        assetId="asset-1"
        projectId="project-1"
        assetName="Hero.mov"
      />,
    );

    await user.click(screen.getByRole("button", { name: /^share$/i }));
    expect(await screen.findByText("Anyone with the link")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^revoke$/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Revoke share link?")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /^revoke link$/i }),
    );

    await waitFor(() => {
      expect(mockedApi.delete).toHaveBeenCalledWith("/share/token");
    });
    expect(
      await screen.findByRole("button", { name: /create share link/i }),
    ).toBeInTheDocument();
  });
});
