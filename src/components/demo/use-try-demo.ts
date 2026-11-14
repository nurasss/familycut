"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuditStore } from "@/lib/store";
import type { AuditSession } from "@/lib/types";
import { useHasHydrated } from "@/components/use-hydrated";
import type { TryDemoConfirmDialogProps } from "@/components/demo/try-demo-confirm-dialog";

export function isRealNonEmptySession(
  session: AuditSession | null,
  isDemo: boolean,
): boolean {
  return (
    session !== null &&
    !isDemo &&
    (session.expenses.length > 0 || session.goal !== undefined)
  );
}

type UseTryDemoOptions = {
  redirectTo?: string | null;
};

export function useTryDemo({
  redirectTo = "/results",
}: UseTryDemoOptions = {}): {
  requestTryDemo: () => void;
  cancelTryDemo: () => void;
  dialogProps: TryDemoConfirmDialogProps;
} {
  const router = useRouter();
  const hydrated = useHasHydrated();
  const session = useAuditStore((s) => s.session);
  const isDemo = useAuditStore((s) => s.isDemo);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const runDemoAndNavigate = useCallback(() => {
    useAuditStore.getState().loadDemo();
    if (redirectTo) {
      router.push(redirectTo);
    }
  }, [redirectTo, router]);

  const requestTryDemo = useCallback(() => {
    const state = useAuditStore.getState();
    if (isRealNonEmptySession(state.session, state.isDemo)) {
      setConfirmOpen(true);
      return;
    }
    runDemoAndNavigate();
  }, [runDemoAndNavigate]);

  const cancelTryDemo = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  const confirmTryDemo = useCallback(() => {
    setConfirmOpen(false);
    runDemoAndNavigate();
  }, [runDemoAndNavigate]);

  const existingExpenseCount = session?.expenses.length ?? 0;
  const hasGoal = Boolean(session?.goal);
  const hasReportedSavings = Boolean(
    session?.expenses.some(
      (exp) =>
        exp.reportedNewPriceCents !== undefined ||
        exp.completedAt !== undefined ||
        exp.actionStatus === "completed",
    ),
  );

  const open =
    confirmOpen && hydrated && isRealNonEmptySession(session, isDemo);

  return {
    requestTryDemo,
    cancelTryDemo,
    dialogProps: {
      open,
      existingExpenseCount,
      hasGoal,
      hasReportedSavings,
      onCancel: cancelTryDemo,
      onConfirm: confirmTryDemo,
    },
  };
}
