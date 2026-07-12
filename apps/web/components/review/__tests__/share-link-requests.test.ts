import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { createdShareLink } from "./share-dialog.fixtures";
import { loadLink } from "../share-link-requests";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

describe("loadLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null without posting when no enabled link exists", async () => {
    mockedApi.get.mockResolvedValue([
      { ...createdShareLink(), is_enabled: false },
    ]);

    await expect(
      loadLink({ kind: "asset", id: "asset-1" }),
    ).resolves.toBeNull();

    expect(mockedApi.get).toHaveBeenCalledWith("/assets/asset-1/shares");
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent reads for the same target", async () => {
    let resolveLinks: (links: readonly never[]) => void = () => {};
    mockedApi.get.mockReturnValue(
      new Promise<readonly never[]>((resolve) => {
        resolveLinks = resolve;
      }),
    );

    const first = loadLink({ kind: "asset", id: "asset-1" });
    const second = loadLink({ kind: "asset", id: "asset-1" });

    expect(first).toBe(second);
    resolveLinks([]);
    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    expect(mockedApi.get).toHaveBeenCalledOnce();
  });
});
