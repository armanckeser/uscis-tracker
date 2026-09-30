import { AlertCircle, Bell, Check } from "lucide-react";
import type { Toast as ToastValue } from "../hooks/useToast";

export function Toast({ toast, open }: { toast: ToastValue; open: boolean }) {
  if (!toast) return null;
  const Icon = toast.tone === "success" ? Check : toast.tone === "error" ? AlertCircle : Bell;
  return (
    <div className={`toast toast-${toast.tone}`} data-open={open} role="status" aria-live="polite">
      <Icon size={16} />
      <span>{toast.message}</span>
    </div>
  );
}
