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
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  // A marked range posts as a cut ("Add cut"); otherwise it's a plain send
  fireEvent.click(screen.queryByRole("button", { name: "Add cut" }) ?? screen.getByTitle("Send (Enter)"));
}

describe("CommentInput range comments", () => {
  beforeEach(() => {
    localStorage.clear();
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
        expect.objectContaining({ body: "point note", timecodeStart: 12, timecodeEnd: undefined, visibility: "internal" }),
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
        expect.objectContaining({ body: "cut this section", timecodeStart: 12, timecodeEnd: 18, visibility: "internal", isCut: true }),
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
        expect.objectContaining({ body: "cut this", timecodeStart: 12, timecodeEnd: 18, visibility: "internal", isCut: true }),
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
        expect.objectContaining({ body: "same spot", timecodeStart: 12, timecodeEnd: undefined, visibility: "internal" }),
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
        expect.objectContaining({ body: "just here", timecodeStart: 18, timecodeEnd: undefined, visibility: "internal" }),
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
        expect.objectContaining({ body: "frozen out", timecodeStart: 12, timecodeEnd: 18, visibility: "internal", isCut: true }),
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
        expect.objectContaining({ body: "o first", timecodeStart: 8, timecodeEnd: 20, visibility: "internal", isCut: true }),
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
        expect.objectContaining({ body: "no time", timecodeStart: undefined, timecodeEnd: undefined, visibility: "internal" }),
      ),
    );
  });

  it("restores and persists the last-used visibility", async () => {
    localStorage.setItem("ff-comment-visibility", "public");
    const onSubmit = setup();

    fireEvent.click(await screen.findByRole("button", { name: /Public/ }));
    fireEvent.click(screen.getByRole("button", { name: "Internal" }));

    expect(localStorage.getItem("ff-comment-visibility")).toBe("internal");
    await typeAndSend("team note");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ body: "team note", timecodeStart: undefined, timecodeEnd: undefined, visibility: "internal" }),
      ),
    );
  });

  it("posts an I/O range as a cut; the note is optional", async () => {
    const onSubmit = setup();
    act(() => {
      useReviewStore.setState({ rangeStart: 6.8, rangeEnd: 9 });
    });
    expect(screen.getByText("0:06.8 → 0:09.0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add cut" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ body: "", timecodeStart: 6.8, timecodeEnd: 9, isCut: true }),
      ),
    );
  });

  it("a point comment is never a cut", async () => {
    const onSubmit = setup();
    setPlayhead(12);
    await typeAndSend("nice");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ body: "nice", isCut: undefined })),
    );
  });
});
