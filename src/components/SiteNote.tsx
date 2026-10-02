import { LOCAL_MODE } from "../lib/mode";

/**
 * The fine print under every view.
 *
 * The app carries a government agency's name, so it says plainly that it is not
 * the agency. The browser-only build is the one strangers use, so it also links
 * to the source and to what the page collects; a self-hosted tracker is its
 * owner's own and needs neither. The privacy link is the only place the app
 * names the author's site, which is why the publish gate's personal-domain rule
 * is allowed for this file and nowhere else.
 */
export function SiteNote() {
  return (
    <footer className="site-note label">
      <p>Not affiliated with USCIS or DHS. Not legal advice.</p>
      {LOCAL_MODE && (
        <p>
          <a href="https://github.com/armanckeser/uscis-tracker" target="_blank" rel="noopener">
            Source on GitHub
          </a>
          <span aria-hidden="true"> · </span>
          <a href="https://armanckeser.com/privacy#demos" target="_blank" rel="noopener">
            Privacy
          </a>
        </p>
      )}
    </footer>
  );
}
