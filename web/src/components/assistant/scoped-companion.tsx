"use client";

import { AdminAssistantWorkspace } from "./admin-assistant";
import { GlobalAssistantCompanion } from "./global-companion";
import { OperatorAssistant } from "./operator-assistant";
import { scopedAssistantContext } from "./page-context";

export function ScopedAssistantCompanion({
  scope,
  view,
  viewerName,
}: {
  readonly scope: "operator" | "admin";
  readonly view: string;
  readonly viewerName?: string | null;
}) {
  const context = scopedAssistantContext(scope, view);
  return (
    <GlobalAssistantCompanion
      context={context}
      empty={false}
      onSuggestion={() => undefined}
      scope={scope}
    >
      <div className="h-full [&>div]:h-full [&>div]:min-h-0 [&>div]:bg-background">
        {scope === "operator" ? (
          <OperatorAssistant compact viewerName={viewerName} />
        ) : (
          <AdminAssistantWorkspace compact viewerName={viewerName} />
        )}
      </div>
    </GlobalAssistantCompanion>
  );
}
