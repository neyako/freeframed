import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/(dashboard)/page";
import { api } from "@/lib/api";
import type { AssetResponse } from "@/types";

const mocks = vi.hoisted(() => ({
  asset: {
    id: "asset-1",
    project_id: "project-1",
    name: "Hero.mov",
    description: null,
    asset_type: "video",
    status: "draft",
    rating: null,
    assignee_id: null,
    folder_id: null,
    due_date: null,
    keywords: [],
    created_by: "user-1",
    created_at: "2026-07-07T00:00:00Z",
    updated_at: "2026-07-07T00:00:00Z",
    deleted_at: null,
    latest_version: null,
    thumbnail_url: null,
  } satisfies AssetResponse,
  mutateOwned: vi.fn<() => Promise<void>>(async () => undefined),
  mutateAssigned: vi.fn<() => Promise<void>>(async () => undefined),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    readonly children: ReactNode;
    readonly href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("swr", () => ({
  default: (key: string) => {
    if (key === "/me/assets?filter=owned") {
      return { data: [mocks.asset], isLoading: false, mutate: mocks.mutateOwned };
    }
    if (key === "/me/assets?filter=assigned") {
      return { data: [], isLoading: false, mutate: mocks.mutateAssigned };
    }
    return { data: [], isLoading: false, mutate: vi.fn() };
  },
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: () => ({
    user: { id: "user-1", name: "Neya", email: "neya@example.com" },
  }),
}));

vi.mock("@/components/dashboard/quick-share", () => ({
  QuickShare: () => <div data-testid="quick-share" />,
}));

vi.mock("@/components/dashboard/storage-meter", () => ({
  StorageMeter: () => <div data-testid="storage-meter" />,
}));

const mockedApi = vi.mocked(api);

describe("HomePage asset delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.delete.mockResolvedValue(undefined);
  });

  it("deletes an asset from the dashboard and revalidates both asset lists", async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole("button", { name: "Delete Hero.mov" }));
    expect(screen.getByText('Delete "Hero.mov"?')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete asset" }));

    await waitFor(() => {
      expect(mockedApi.delete).toHaveBeenCalledWith("/assets/asset-1");
    });
    expect(mocks.mutateOwned).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAssigned).toHaveBeenCalledTimes(1);
  });
});
