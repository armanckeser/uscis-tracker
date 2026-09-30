import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ShowToast } from "../../hooks/useToast";

// A copyable block of script text. Distinct from BookmarkletRow, which renders a
// draggable `javascript:` link: this is a bare script pasted into an iOS Shortcut
// action, so it is not a URL and must not be presented as one.
export function ScriptBlock({
  code,
  showToast,
}: {
  code: string;
  showToast: ShowToast;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("error", "Could not copy. Select the text and copy it manually.");
    }
  }

  return (
    <div className="script-block">
      <button className="button button-secondary" type="button" onClick={() => void handleCopy()}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? "Copied" : "Copy script"}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
