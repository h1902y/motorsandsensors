import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { useReviewOpen } from "../state/review";
import { useView } from "../state/view";
import { pendingReviewCount } from "../faculties/review-queue";
import { StartAgentButton } from "../faculties/StartAgentButton";
import { Button } from "../components/ui";
import { digestPeek, facultyQuickLinks } from "./agent-panel-logic";

const DIGEST_PATH = ".zuzuu/.live/digest.md";

/** The 4th sidebar tab: the agent at a glance — pending review, start a
 *  session, a digest peek, and quick links into the faculty files. */
export function AgentPanel() {
  const health = useQuery({ queryKey: ["zuzuu", "health"], queryFn: zuzuuApi.health, refetchInterval: 8000 });
  const homeExists = health.data?.home === true;
  const evalQ = useQuery({ queryKey: ["zuzuu", "eval"], queryFn: zuzuuApi.evalRanked, refetchInterval: 8000, enabled: homeExists });
  const actionsQ = useQuery({ queryKey: ["zuzuu", "faculty", "actions"], queryFn: () => zuzuuApi.faculty("actions"), refetchInterval: 8000, enabled: homeExists });
  const digestQ = useQuery({ queryKey: ["zuzuu", "digest"], queryFn: zuzuuApi.digest, refetchInterval: 6000, enabled: homeExists });
  const openReview = useReviewOpen((s) => s.setOpen);
  const setView = useView((s) => s.setMode);
  const openPath = useExplorer((s) => s.openPreviewPath);

  // health still loading → don't flash the full panel (or fire the hosts fetch)
  if (!health.data) {
    return <div className="p-3 text-meta text-ink-600">…</div>;
  }
  if (!homeExists) {
    return (
      <div className="flex flex-col gap-3 p-3 text-ui text-ink-300">
        <div>No zuzuu home here yet.</div>
        <Button size="sm" onClick={() => setView("faculties")}>
          Set up zuzuu
        </Button>
      </div>
    );
  }

  // same combined queue the review ceremony walks (eval-ranked + action inbox)
  const reviewCount = pendingReviewCount(evalQ.data?.ranked ?? [], actionsQ.data?.proposals ?? []);
  const digest = digestQ.data?.text ?? "";
  const peek = digestPeek(digest);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {/* pending review */}
      <div className="flex items-center gap-2">
        <span className="text-ui text-ink-300">
          {reviewCount} pending review
        </span>
        {reviewCount > 0 && (
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => openReview(true)}>
            Review
          </Button>
        )}
      </div>

      {/* start an agent session */}
      <StartAgentButton size="sm" />

      {/* digest peek */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center text-meta uppercase tracking-wide text-ink-500">
          digest
          {digest.trim() !== "" && (
            <button
              className="ml-auto normal-case tracking-normal text-ink-500 hover:text-accent"
              onClick={() => openPath(DIGEST_PATH)}
            >
              open full
            </button>
          )}
        </div>
        {digest.trim() === "" ? (
          <div className="text-meta text-ink-600">no digest yet — generated each session</div>
        ) : (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-ui border border-border bg-surface p-2 text-meta text-ink-300">
            {peek.text}
            {peek.truncated ? "\n…" : ""}
          </pre>
        )}
      </div>

      {/* faculty quick-links */}
      <div className="flex flex-col gap-1">
        <div className="text-meta uppercase tracking-wide text-ink-500">faculties</div>
        {facultyQuickLinks().map((row) => (
          <div key={row.faculty} className="flex items-baseline gap-2 text-ui">
            <button
              className="text-ink-300 hover:text-accent"
              title={row.readme.path}
              onClick={() => openPath(row.readme.path)}
            >
              {row.faculty}
            </button>
            {row.extras.map((link) => (
              <button
                key={link.path}
                className="text-meta text-ink-500 hover:text-accent"
                title={link.path}
                onClick={() => openPath(link.path)}
              >
                {link.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
