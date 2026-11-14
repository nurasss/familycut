"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/** Avoid SSR hydration mismatch for client-persisted Zustand store reads. */
export function useHasHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
