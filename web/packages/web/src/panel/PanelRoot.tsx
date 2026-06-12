// The panel root (IA v3) — three sections, one scroll:
//   §1 Needs you   — pending groups + the Review CTA + drift/CLI banners
//   §2 Sessions    — active pinned (Session brief beneath) + recent rows
//   §3 Faculties   — compact 2-col tile grid (manifest ui descriptors)
// Data: ONE batched overview read (one daemon-side CLI spawn) + the
// sessions list + status; drill-ins fetch their own detail.
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { useRightPanel } from "../state/right-panel";
import { FACULTY_ORDER, FacultyTile, Section, facultyDisplay } from "./kit";
import { NeedsYou } from "./NeedsYou";
import { SessionsSection } from "./SessionsSection";
import { GenerationsTimeline } from "./GenerationsTimeline";

export function PanelRoot({ zuzuuBin }: { zuzuuBin: boolean }) {
  const openFaculty = useRightPanel((s) => s.openFaculty);
  const overview = useQuery({ queryKey: ["zuzuu", "overview"], queryFn: zuzuuApi.overview, refetchInterval: 8000 });
  const status = useQuery({ queryKey: ["zuzuu", "status"], queryFn: zuzuuApi.status, refetchInterval: 8000 });

  // overview order, with the built-in order as the spine (declarative
  // faculties the CLI reports beyond the five list after them)
  const entries = overview.data?.faculties ?? [];
  const ids = [
    ...FACULTY_ORDER.filter((k) => entries.length === 0 || entries.some((e) => e.id === k)),
    ...entries.map((e) => e.id).filter((id) => !(FACULTY_ORDER as string[]).includes(id)),
  ];

  return (
    <div className="flex flex-col gap-5 p-3">
      <NeedsYou faculties={entries} status={status.data} zuzuuBin={zuzuuBin} />
      <SessionsSection />
      <Section label="faculties">
        <div className="grid grid-cols-2 gap-2">
          {ids.map((id) => {
            const entry = entries.find((e) => e.id === id);
            return (
              <FacultyTile
                key={id}
                display={facultyDisplay(id, entry)}
                count={entry?.counts.items ?? 0}
                pending={entry?.counts.pending ?? 0}
                onOpen={() => openFaculty(id as Parameters<typeof openFaculty>[0])}
              />
            );
          })}
        </div>
        <GenerationsTimeline />
      </Section>
    </div>
  );
}
