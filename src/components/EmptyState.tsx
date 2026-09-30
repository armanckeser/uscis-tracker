import type { ReactNode } from "react";

/** One sentence and one action. The title is optional; the action is whatever the caller passes. */
export function EmptyState({ title, body, icon, action }: { title?: string; body: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      {title && <strong>{title}</strong>}
      <p>{body}</p>
      {action}
    </div>
  );
}
