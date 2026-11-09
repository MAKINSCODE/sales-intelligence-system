"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunView } from "@/lib/research/view";

export type Connection = "ok" | "retrying" | "offline";

const REQUEST_TIMEOUT_MS = 12_000;

// Time to the next check. Fast while a run is young, slower as it ages (less data on mobile links), and
// exponentially slower with jitter while the connection is failing, so many tabs do not hammer a recovering server.
export function nextDelay(sinceStartMs: number, failures: number, hidden: boolean, random = Math.random): number {
  if (failures > 0) return Math.round(Math.min(15_000, 2_000 * 2 ** (failures - 1)) * (0.8 + random() * 0.4));
  if (hidden) return 10_000;
  return sinceStartMs < 30_000 ? 1_500 : sinceStartMs < 120_000 ? 3_000 : 5_000;
}

export function useRunPoll({ leadId, active, onRun, onSignedOut }: { leadId: string; active: boolean; onRun: (run: RunView | null) => void; onSignedOut: () => void }) {
  const [connection, setConnection] = useState<Connection>("ok");
  const failures = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  // Callbacks are kept in a ref so a parent re-render does not restart polling.
  const handlers = useRef({ onRun, onSignedOut });
  useEffect(() => {
    handlers.current = { onRun, onSignedOut };
  });

  const request = useCallback(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/leads/${leadId}/run`, { cache: "no-store", signal: controller.signal });
      if (res.status === 401) return handlers.current.onSignedOut();
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { run: RunView | null };
      failures.current = 0;
      setConnection("ok");
      handlers.current.onRun(data.run);
    } catch {
      failures.current++;
      // One miss is ordinary on a mobile link; two in a row is worth telling the person about.
      if (failures.current >= 2) setConnection(navigator.onLine ? "retrying" : "offline");
    } finally {
      clearTimeout(timer);
    }
  }, [leadId]);

  // Only one request at a time, so a slow link cannot stack requests and answers cannot arrive out of order.
  // `fresh` waits for a running request and then asks again, for use right after the person changed something.
  const refresh = useCallback(
    async (fresh = false) => {
      if (inFlight.current) {
        await inFlight.current;
        if (!fresh) return;
      }
      const p = request().finally(() => {
        inFlight.current = null;
      });
      inFlight.current = p;
      await p;
    },
    [request],
  );

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    const startedAt = Date.now();

    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await refresh();
      } finally {
        running = false;
      }
      if (!stopped) timer = setTimeout(tick, nextDelay(Date.now() - startedAt, failures.current, document.visibilityState === "hidden"));
    };
    // Coming back to the tab or regaining the network checks straight away instead of waiting out a long delay.
    const wake = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || running) return;
      clearTimeout(timer);
      void tick();
    };

    timer = setTimeout(tick, 1_500);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [active, refresh]);

  return { connection, refresh };
}
