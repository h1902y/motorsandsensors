import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { launchInTerminal } from "../lib/agent-launch";
import { Button, MenuPopover, type MenuItem } from "../components/ui";
import { buildHostRows } from "./host-launch";

/** "Start agent session ▾" + the detected-hosts popover — launches a wrapped
 *  host in a fresh terminal. Shared by the Home CTAs and the agent sidebar. */
export function StartAgentButton({ size = "md" }: { size?: "sm" | "md" }) {
  const hostsQ = useQuery({ queryKey: ["zuzuu", "hosts"], queryFn: zuzuuApi.hosts, refetchInterval: 8000 });
  const [open, setOpen] = useState(false);

  const items: MenuItem[] = buildHostRows(hostsQ.data?.hosts ?? []).map((row) => ({
    label: row.label,
    disabled: !row.detected,
    hint: row.detected ? undefined : "not installed",
    onClick: () => void launchInTerminal(row.command),
  }));

  return (
    <div className="relative">
      <Button variant="primary" size={size} onClick={() => setOpen((v) => !v)}>
        Start agent session <span className="opacity-70">▾</span>
      </Button>
      {open && <MenuPopover items={items} align="left" onClose={() => setOpen(false)} />}
    </div>
  );
}
