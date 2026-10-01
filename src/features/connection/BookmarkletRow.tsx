import { useEffect, useRef, useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import type { ShowToast } from "../../hooks/useToast";

export function BookmarkletRow({
  label,
  hint,
  code,
  showToast,
}: {
  label: string;
  hint: string;
  code: string;
  showToast: ShowToast;
}) {
  const [copied, setCopied] = useState(false);
  const link = useRef<HTMLAnchorElement>(null);

  // React refuses to render a `javascript:` href and substitutes one that throws,
  // so a bookmark dragged from this link did nothing. The address is this page's
  // own generated script, not user input, so it is set on the element directly.
  useEffect(() => {
    link.current?.setAttribute("href", code);
  }, [code]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("error", "Could not copy. Long-press the link to copy it manually.");
    }
  }

  return (
    <div className="bookmarklet-row">
      <div className="bookmarklet-row-head">
        {/* href is the bookmarklet itself so desktop users can drag it to their bar.
            Tapping it in-app does nothing useful, so copy is primary on phones. */}
        <a ref={link} className="bookmarklet-link" href="#" onClick={(event) => event.preventDefault()} draggable>
          <Smartphone size={15} />
          {label}
        </a>
        <button className="button button-secondary" type="button" onClick={() => void handleCopy()}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="field-help">{hint}</p>
    </div>
  );
}
