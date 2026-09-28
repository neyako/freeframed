import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareDialog } from "../share-dialog";
import { SingleLinkSection } from "../share-link-section";
import { api } from "@/lib/api";
import { createdShareLink, folderShareLink } from "./share-dialog.fixtures";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);
const writeText = vi.fn<(text: string) => Promise<void>>();

it("does not model a decrypted share passphrase", () => {
  expect(createdShareLink()).not.toHaveProperty("password_value");
});

describe("ShareDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.setPointerCapture ??= vi.fn();
    Element.prototype.releasePointerCapture ??= vi.fn();
    Element.prototype.scrollIntoView ??= vi.fn();
  });

  it("creates and edits one asset share link only after an explicit click", async () => {
    const user = userEvent.setup();
    const link = createdShareLink();

    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/assets/asset-1/shares") return [];
      return [];
    });
    mockedApi.post.mockImplementation(async (path: string) => {
      if (path === "/assets/asset-1/share") return link;
      return {};
    });
    mockedApi.patch.mockResolvedValue({ ...link, permission: "view" });

    render(<ShareDialog assetId="asset-1" />);

    await user.click(screen.getByRole("button", { name: /share/i }));

    expect(screen.getByText("Share", { selector: "button span" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /new share link/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/add to existing share links/i)).not.toBeInTheDocument();

    expect(await screen.findByText("No share link")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /create share link/i }),
    );

    expect(await screen.findByText("Anyone with the link")).toBeInTheDocument();
    expect(screen.getByText(/\/share\/token$/)).toBeInTheDocument();
    expect(screen.getByText("Access")).toBeInTheDocument();
    expect(screen.getByText("Visibility")).toBeInTheDocument();
    expect(screen.getByText("Passphrase")).toBeInTheDocument();
    expect(screen.getByText("Expiration")).toBeInTheDocument();
    expect(screen.getByText("Watermark")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^revoke$/i })).toHaveClass(
      "border-accent-line",
    );
    expect(screen.getByRole("switch", { name: /allow download/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await user.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();

    expect(mockedApi.get).toHaveBeenCalledWith("/assets/asset-1/shares");
    expect(mockedApi.post).toHaveBeenCalledWith("/assets/asset-1/share", {
      permission: "comment",
      allow_download: false,
    });

    expect(screen.getByRole("button", { name: "Comment" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith("/share/token", {
        permission: "view",
      });
    });
  });

  it("creates a folder share link after an explicit click", async () => {
    const user = userEvent.setup();
    const link = folderShareLink();

    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/folders/folder-1/shares") return [];
      return [];
    });
    mockedApi.post.mockImplementation(async (path: string) => {
      if (path === "/folders/folder-1/share") return link;
      return {};
    });

    render(<SingleLinkSection target={{ kind: "folder", id: "folder-1" }} />);

    expect(await screen.findByText("No share link")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /create share link/i }),
    );

    expect(await screen.findByText("Anyone with the link")).toBeInTheDocument();
    expect(screen.getByText(/\/share\/folder-token$/)).toBeInTheDocument();

    expect(mockedApi.get).toHaveBeenCalledWith("/folders/folder-1/shares");
    expect(mockedApi.post).toHaveBeenCalledWith("/folders/folder-1/share", {
      permission: "view",
      allow_download: false,
    });
  });

  it("reveals a passphrase input and sends a write-only password patch", async () => {
    const user = userEvent.setup();
    const link = createdShareLink();

    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/assets/asset-1/shares") return [link];
      return [];
    });
    mockedApi.patch.mockImplementation(async (_path: string, updates: unknown) => {
      if (
        typeof updates === "object" &&
        updates !== null &&
        "password" in updates &&
        updates.password === ""
      ) {
        return { ...link, has_password: false };
      }
      return { ...link, has_password: true };
    });

    render(<SingleLinkSection target={{ kind: "asset", id: "asset-1" }} />);

    expect(await screen.findByText("Passphrase")).toBeInTheDocument();
    expect(screen.queryByLabelText(/link passphrase/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: /passphrase/i }));

    const input = screen.getByLabelText(/link passphrase/i);
    expect(input).toBeInTheDocument();
    await user.type(input, "secret123");
    await user.tab();

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith("/share/token", {
        password: "secret123",
      });
    });

    await user.click(screen.getByRole("switch", { name: /passphrase/i }));

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith("/share/token", {
        password: "",
      });
    });
    expect(screen.queryByLabelText(/link passphrase/i)).not.toBeInTheDocument();
  });

  it("revokes a single share link and offers to create a new one", async () => {
    const user = userEvent.setup();
    const link = createdShareLink();

    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/assets/asset-1/shares") return [link];
      return [];
    });
    mockedApi.delete.mockResolvedValue(undefined);

    render(<SingleLinkSection target={{ kind: "asset", id: "asset-1" }} />);

    const revokeButton = await screen.findByRole("button", { name: /^revoke$/i });
    expect(revokeButton).toHaveClass("border-accent-line");

    await user.click(revokeButton);

    expect(await screen.findByText("Revoke share link?")).toBeInTheDocument();
    expect(mockedApi.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /revoke link/i }));

    await waitFor(() => {
      expect(mockedApi.delete).toHaveBeenCalledWith("/share/token");
    });
    expect(
      screen.getByRole("button", { name: /create share link/i }),
    ).toBeInTheDocument();
  });
});
