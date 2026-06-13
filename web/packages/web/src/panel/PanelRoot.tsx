// The panel root (IA v3) — three sections, one scroll:
//   §1 Needs you   — pending groups + the Review CTA + drift/CLI banners
//   §2 Sessions    — active pinned (Session brief beneath) + recent rows
//   §3 Modules   — compact 2-col tile grid (manifest ui descriptors)
// Data: ONE batched overview read (one daemon-side CLI spawn) + the
// sessions list + status; drill-ins fetch their own detail.
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { useRightPanel } from "../state/right-panel";
import { MODULE_ORDER, ModuleTile, Section, moduleDisplay } from "./kit";
import { NeedsYou } from "./NeedsYou";
import { SessionsSection } from "./SessionsSection";
import { GenerationsTimeline } from "./GenerationsTimeline";

export function PanelRoot({ zuzuuBin }: { zuzuuBin: boolean }) {
  const openModule = useRightPanel((s) => s.openModule);
  const overview = useQuery({ queryKey: ["zuzuu", "overview"], queryFn: zuzuuApi.overview, refetchInterval: 8000 });
  const status = useQuery({ queryKey: ["zuzuu", "status"], queryFn: zuzuuApi.status, refetchInterval: 8000 });

  // overview order, with the built-in order as the spine (declarative
  // modules the CLI reports beyond the five list after them)
  const entries = overview.data?.modules ?? [];
  const ids = [
    ...MODULE_ORDER.filter((k) => entries.length === 0 || entries.some((e) => e.id === k)),
    ...entries.map((e) => e.id).filter((id) => !(MODULE_ORDER as string[]).includes(id)),
  ];

  return (
    <div className="flex flex-col p-3.5">
      <div className="pb-5">
        <NeedsYou modules={entries} status={status.data} zuzuuBin={zuzuuBin} />
      </div>
      <div className="border-t border-border/70 py-5">
        <SessionsSection />
      </div>
      <div className="border-t border-border/70 pt-5">
      <Section label="modules">
        <div className="grid grid-cols-2 gap-2">
          {ids.map((id, i) => {
            const entry = entries.find((e) => e.id === id);
            return (
              <div key={id} className="wc-rise-in" style={{ animationDelay: `${i * 28}ms` }}>
                <ModuleTile
                  id={id}
                  display={moduleDisplay(id, entry)}
                  count={entry?.counts.items ?? 0}
                  pending={entry?.counts.pending ?? 0}
                  onOpen={() => openModule(id as Parameters<typeof openModule>[0])}
                />
              </div>
            );
          })}
        </div>
        <GenerationsTimeline />
      </Section>
      </div>
    </div>
  );
}
