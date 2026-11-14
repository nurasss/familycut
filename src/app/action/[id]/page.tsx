"use client";

import { Suspense, use } from "react";
import { ActionWorkspace } from "@/components/action/action-workspace";

function safeDecodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function ActionByIdInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <ActionWorkspace
      selectedIdFromRoute={safeDecodeId(id)}
      hasExplicitRouteId={true}
    />
  );
}

export default function ActionByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<ActionWorkspace isRouteLoading />}>
      <ActionByIdInner params={params} />
    </Suspense>
  );
}
