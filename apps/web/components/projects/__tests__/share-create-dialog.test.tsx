import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShareCreateDialog } from "../share-create-dialog";

const initialResult = {
  token: "share-token",
  title: "Client Review",
  itemType: "folder",
  thumbnailUrl: null,
  folderId: "folder-1",
} as const;

function renderDialog(onAdvancedSettings?: (token: string) => void) {
  const onOpenChange = vi.fn();

  render(
    <ShareCreateDialog
      open
      onOpenChange={onOpenChange}
      projectId="project-1"
      currentFolderId={null}
      assets={[]}
      folders={[]}
      initialResult={initialResult}
      onShareCreated={vi.fn()}
      onAdvancedSettings={onAdvancedSettings}
    />,
  );

  return { onOpenChange };
}

describe("ShareCreateDialog", () => {
  it("hides advanced settings when no destination handler is provided", () => {
    renderDialog();

    expect(
      screen.queryByRole("button", { name: /advanced settings/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
  });

  it("opens advanced settings when a destination handler is provided", async () => {
    const user = userEvent.setup();
    const onAdvancedSettings = vi.fn();
    const { onOpenChange } = renderDialog(onAdvancedSettings);

    await user.click(screen.getByRole("button", { name: /advanced settings/i }));

    expect(onAdvancedSettings).toHaveBeenCalledWith("share-token");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
