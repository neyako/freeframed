import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import AdminPage from "../page";
import { api } from "@/lib/api";
import type { AdminUser, User } from "@/types";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  useAuthStore: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: mocks.useAuthStore,
}));

vi.mock("@/lib/api", () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

const currentUser: User = {
  id: "admin-user-id",
  email: "admin@example.com",
  name: "Admin User",
  avatar_url: null,
  status: "active",
  is_superadmin: true,
  email_verified: true,
  preferences: {},
  created_at: "2026-07-11T00:00:00Z",
  deleted_at: null,
};

const pendingUser: AdminUser = {
  id: "pending-user-id",
  email: "pending@example.com",
  name: "Pending User",
  avatar_url: null,
  status: "pending_invite",
  is_superadmin: false,
  email_verified: false,
  invite_token: "fixed-synthetic-invite-token",
  preferences: {},
  created_at: "2026-07-11T00:00:00Z",
  deleted_at: null,
};

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuthStore.mockReturnValue({
      user: currentUser,
      isSuperAdmin: true,
    });
    vi.mocked(api.get).mockResolvedValue([pendingUser]);
  });

  it("keeps invite tokens out of User and on AdminUser", () => {
    expectTypeOf<Extract<keyof User, "invite_token">>().toEqualTypeOf<never>();
    expectTypeOf<AdminUser["invite_token"]>().toEqualTypeOf<string | null>();
  });

  it("copies the pending invite link from the privileged admin list", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AdminPage />
      </SWRConfig>,
    );

    expect(await screen.findByText("Pending User")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Copy Invite Link" }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/invite/fixed-synthetic-invite-token`,
      );
    });
  });
});
