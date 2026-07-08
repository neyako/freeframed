import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { CommentInput } from "../comment-input";
import { useReviewStore } from "@/stores/review-store";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock("../review-provider", () => ({
  useReview: () => ({ pauseVideo: vi.fn() }),
}));

vi.mock("@/hooks/use-drawing", () => ({
  useDrawing: () => ({
    clear: vi.fn(),
    undo: vi.fn(),
    getJSON: () => ({ objects: [] }),
  }),
}));

function setup() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <CommentInput
      assetId="a1"
      projectId="p1"
      assetType="video"
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

function setPlayhead(time: number) {
  act(() => {
    useReviewStore.setState({ playheadTime: time });
  });
}

async function typeAndSend(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Leave your comment..."), {
    target: { value: text },
  });
  fireEvent.click(screen.getByTitle("Send (Enter)"));
}

describe("CommentInput range comments", () => {
  beforeEach(() => {
    useReviewStore.setState({
      playheadTime: 0,
      rangeStart: null,
      rangeEnd: null,
      isDrawingMode: false,
      pendingAnnotation: null,
    });
  });

  it("submits point comment when no range set (existing behavior)", async () => {
    const onSubmit = setup();
    setPlayhead(12);
    await typeAndSend("point note");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "point note", 12, undefined, undefined, undefined, "public", undefined,
      ),
    );
  });

  it("submits range when in-point set then playhead scrubbed forward", async () => {
    const onSubmit = setup();
    setPlayhead(12);
    fireEvent.click(screen.getByTitle("Set range start (I)"));
    setPlayhead(18);
    await typeAndSend("cut this section");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "cut this section", 12, 18, undefined, undefined, "public", undefined,
      ),
    );
    // range resets after submit — chip back in point mode
    await waitFor(() =>
      expect(screen.getByTitle("Set range start (I)")).toBeTruthy(),
    );
  });

  it("swaps start/end when playhead scrubbed backward past in-point", async () => {
    const onSubmit = setup();
    setPlayhead(18);
    fireEvent.click(screen.getByTitle("Set range start (I)"));
    setPlayhead(12);
    await typeAndSend("cut this");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "cut this", 12, 18, undefined, undefined, "public", undefined,
      ),
    );
  });

  it("degrades to point comment when in-point equals playhead", async () => {
    const onSubmit = setup();
    setPlayhead(12);
    fireEvent.click(screen.getByTitle("Set range start (I)"));
    await typeAndSend("same spot");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "same spot", 12, undefined, undefined, undefined, "public", undefined,
      ),
    );
  });

  it("clearing the range restores point-comment behavior", async () => {
    const onSubmit = setup();
    setPlayhead(12);
    fireEvent.click(screen.getByTitle("Set range start (I)"));
    setPlayhead(18);
    fireEvent.click(screen.getByTitle("Clear range"));
    await typeAndSend("just here");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "just here", 18, undefined, undefined, undefined, "public", undefined,
      ),
    );
  });

  it("uses a frozen out-point (O key path) even after the playhead moves on", async () => {
    const onSubmit = setup();
    setPlayhead(12);
    fireEvent.click(screen.getByTitle("Set range start (I)"));
    act(() => {
      useReviewStore.getState().setRangeEnd(18); // what the O shortcut does
    });
    setPlayhead(40); // playhead keeps moving; frozen out-point must win
    await typeAndSend("frozen out");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "frozen out", 12, 18, undefined, undefined, "public", undefined,
      ),
    );
  });

  it("out-point alone anchors a range back to the playhead", async () => {
    const onSubmit = setup();
    setPlayhead(20);
    act(() => {
      useReviewStore.getState().setRangeEnd(20); // O pressed with no in-point
    });
    setPlayhead(8); // scrub back — in-point follows playhead
    await typeAndSend("o first");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "o first", 8, 20, undefined, undefined, "public", undefined,
      ),
    );
  });

  it("detaching the timecode also clears the range", async () => {
    const onSubmit = setup();
    setPlayhead(12);
    fireEvent.click(screen.getByTitle("Set range start (I)"));
    fireEvent.click(screen.getByTitle("Detach timecode"));
    await typeAndSend("no time");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "no time", undefined, undefined, undefined, undefined, "public", undefined,
      ),
    );
  });
});
