import { create } from "zustand";

interface ReviewOpenState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Whether the review ceremony (faculties/ReviewFlow) is showing — its own
 *  store so any surface (status header, sidebar, palette) can open it. */
export const useReviewOpen = create<ReviewOpenState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
