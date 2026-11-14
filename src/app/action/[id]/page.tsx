"use client";

import { Suspense, use } from "react";
import { ActionWorkspace } from "@/components/action/action-workspace";

function ActionByIdInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ActionWorkspace selectedIdFromRoute={decodeURIComponent(id)} />;
}

export default function ActionByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<ActionWorkspace />}>
      <ActionByIdInner params={params} />
    </Suspense>
  );
}
