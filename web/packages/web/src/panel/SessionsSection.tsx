// §2 Sessions — observability v1: the ACTIVE session pinned (with the
// Session brief beneath it), then completed/abandoned/captured rows.
// Row click → that session's detail drill-in.
import type { ZuzuuSessionEntry } from "@zuzuu-web/protocol";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { StatusDot, cx } from "../components/ui";
import { useRightPanel } from "../state/right-panel";
import { Section, relativeTime } from "./kit";
import { SessionBrief } from "./SessionBrief";
import { fmtDuration, sessionStateMeta, shortSessionId, splitSessions } from "./sections";

const TONE_TEXT = {
  ok: "text-status-ok",
  warn: "text-warn",
  danger: "text-danger",
  idle: "text-ink-500",
} as const;

function SessionRow({ session, pinned = false }: { session: ZuzuuSessionEntry; pinned?: boolean }) {
  const openSession = useRightPanel((s) => s.openSession);
  const meta = sessionStateMeta(session.state);
  const dur = fmtDuration(session.durationMs);
  const when = relativeTime(session.startedAt ?? undefined);
  return (
    <button
      onClick={() => openSession(session.id)}
      className={cx(
        "flex w-full items-center gap-2 py-1.5 text-left text-ui transition-colors hover:bg-hover",
        pinned ? "" : "border-b border-border last:border-0",
      )}
      title={`Inspect session ${session.id}`}
    >
      <StatusDot
        tone={meta.tone === "danger" ? "bad" : meta.tone === "warn" ? "warn" : meta.tone === "ok" ? "ok" : "idle"}
        pulse={meta.pulse}
      />
      <span className="text-ink-100">{session.host ?? "?"}</span>
      <span className={cx("text-meta", TONE_TEXT[meta.tone])}>{meta.label}</span>
      <span className="ml-auto flex shrink-0 items-baseline gap-2 text-meta text-ink-600">
        {when && <span>{when}</span>}
        {dur && <span>{dur}</span>}
        <span className="font-mono">{shortSessionId(session.id)}</span>
      </span>
    </button>
  );
}

export function SessionsSection() {
  const q = useQuery({ queryKey: ["zuzuu", "sessions"], queryFn: zuzuuApi.sessions, refetchInterval: 6000 });
  const { active, rest } = splitSessions(q.data?.sessions ?? []);
  const count = (q.data?.sessions ?? []).length;

  return (
    <Section label={`sessions${count > 0 ? ` (${count})` : ""}`}>
      {count === 0 ? (
        <div className="py-1 text-meta text-ink-600">
          none yet — sessions are captured as you work with a host
        </div>
      ) : (
        <div className="flex flex-col">
          {/* the live session pins to the top; its brief rides beneath it */}
          {active && (
            <div className="mb-1.5 flex flex-col gap-1 rounded-ui border border-border bg-surface px-2 pb-2 pt-0.5">
              <SessionRow session={active} pinned />
              <SessionBrief />
            </div>
          )}
          {rest.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </Section>
  );
}
