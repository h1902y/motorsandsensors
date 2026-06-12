import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { StatusHeader } from "./StatusHeader";
import { FacultyCard } from "./FacultyCard";
import { FacultyDetail } from "./FacultyDetail";
import { GenerationsTimeline } from "./GenerationsTimeline";
import { SessionsList } from "./SessionsList";
import { DigestPanel } from "./DigestPanel";
import { ReviewFlow } from "./ReviewFlow";

/** The full-pane zuzuu faculties dashboard (observe + review). */
export function FacultiesView() {
  const [active, setActive] = useState<string | null>(null);
  const faculties = useQuery({ queryKey: ["zuzuu", "faculties"], queryFn: zuzuuApi.faculties, refetchInterval: 4000 });
  const status = useQuery({ queryKey: ["zuzuu", "status"], queryFn: zuzuuApi.status });
  const noHome = status.data?.home === false;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-5">
      <StatusHeader />
      {!noHome && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {faculties.data?.faculties.map((f) => (
              <FacultyCard key={f.key} data={f} active={f.key === active} onSelect={() => setActive(active === f.key ? null : f.key)} />
            ))}
          </div>
          {active && <FacultyDetail facultyKey={active} />}
          <GenerationsTimeline />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SessionsList />
            <DigestPanel />
          </div>
        </>
      )}
      <ReviewFlow />
    </div>
  );
}
