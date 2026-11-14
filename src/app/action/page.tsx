"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ActionWorkspace } from "@/components/action/action-workspace";

function ActionPageInner() {
  const searchParams = useSearchParams();
  const hasIdParam = searchParams.has("id");
  const id = searchParams.get("id") ?? undefined;
  return (
    <ActionWorkspace
      selectedIdFromRoute={id}
      hasExplicitRouteId={hasIdParam}
    />
  );
}

export default function ActionPage() {
  return (
    <Suspense fallback={<ActionWorkspace isRouteLoading />}>
      <ActionPageInner />
    </Suspense>
  );
}
