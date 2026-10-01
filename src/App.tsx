import { useState } from "react";
import { latestCheckedAt, latestSnapshotIdFor } from "./lib/uscis";
import { useRoute } from "./hooks/useRoute";
import { useToast } from "./hooks/useToast";
import { useSummary } from "./hooks/useSummary";
import { usePush } from "./hooks/usePush";
import { useRefreshHandoff } from "./hooks/useRefreshHandoff";
import { useSnapshotViewer } from "./hooks/useSnapshotViewer";
import { MobileNav, TopBar } from "./components/Navigation";
import { FreshnessSheet } from "./components/FreshnessSheet";
import { Toast } from "./components/Toast";
import { LoadingState } from "./components/LoadingState";
import { RawSnapshotModal } from "./components/RawSnapshotModal";
import { TimelineView } from "./features/timeline/TimelineView";
import { ConnectionView } from "./features/connection/ConnectionView";

// App shell: routing, shared data, and the chrome. Everything substantive lives
// in the timeline and connection features.
function App() {
  const { route, navigate } = useRoute();
  const { toast, open: toastOpen, showToast } = useToast();
  const { summary, loading, refresh } = useSummary(showToast);
  const { pushState, pushBusy, togglePush } = usePush(summary?.config.vapidPublicKey, showToast);
  const { snapshot: selectedSnapshot, open: openSnapshot, close: closeSnapshot } = useSnapshotViewer(showToast);
  const [freshnessOpen, setFreshnessOpen] = useState(false);
  const { found, assignFound, dismissFound } = useRefreshHandoff(showToast, refresh);

  const checkedAt = summary ? latestCheckedAt(summary.cases) : null;

  return (
    <div className="app-shell">
      <TopBar route={route} navigate={navigate} lastCheckedAt={checkedAt} onOpenFreshness={() => setFreshnessOpen(true)} />

      <main className="main">
        {loading && !summary ? (
          <LoadingState />
        ) : summary ? (
          <div className="view-frame" key={route}>
            {route === "home" ? (
              <TimelineView summary={summary} showToast={showToast} refresh={refresh}
                onOpenSnapshot={openSnapshot}
                onOpenConnection={() => navigate("connection")}
                found={found}
                onAssignFound={assignFound}
                onDismissFound={dismissFound}
              />
            ) : (
              <ConnectionView
                summary={summary}
                refresh={refresh}
                showToast={showToast}
                pushState={pushState}
                pushBusy={pushBusy}
                onTogglePush={() => void togglePush()}
              />
            )}
          </div>
        ) : (
          <LoadingState />
        )}
      </main>

      <MobileNav route={route} navigate={navigate} />

      {freshnessOpen && (
        <FreshnessSheet lastCheckedAt={checkedAt} onOpenConnection={() => navigate("connection")} onClose={() => setFreshnessOpen(false)} />
      )}

      {selectedSnapshot && (
        <RawSnapshotModal
          snapshot={selectedSnapshot}
          latestSnapshotId={summary ? latestSnapshotIdFor(summary.cases, selectedSnapshot.case_id) : null}
          onOpenLatest={(snapshotId) => void openSnapshot(snapshotId)}
          onClose={closeSnapshot}
        />
      )}
      <Toast toast={toast} open={toastOpen} />
    </div>
  );
}

export default App;
