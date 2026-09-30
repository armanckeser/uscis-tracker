import { Loader2 } from "lucide-react";

export function LoadingState() {
  return (
    <div className="loading-state">
      <Loader2 className="spin" size={24} />
      <span>Loading tracker data</span>
    </div>
  );
}
