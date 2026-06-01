import { useMemo, type ReactNode } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { getBalance } from "../game/balance";
import type { ViewerRequest } from "../game/types";

function rewardLabel(req: ViewerRequest, difficulty: ReturnType<typeof useStore.getState>["settings"]["difficulty"]): string {
  if (req.rewardType === "cash" && req.rewardAmount) return `$${req.rewardAmount} tip`;
  return `+${getBalance(difficulty ?? "normal").affinity.sources.request} bond`;
}

/** Modal listing viewer content requests and fulfillment controls. */
export function RequestsPanel({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.requestsOpen);
  const close = useStore((s) => s.setRequestsOpen);
  const viewerRequests = useStore((s) => s.viewerRequests);
  const roster = useStore((s) => s.roster);
  const requestsBusy = useStore((s) => s.requestsBusy);
  const resolving = useStore((s) => s.resolving);
  const openCharacter = useStore((s) => s.openCharacter);

  const { openReqs, fulfilled, dismissed } = useMemo(() => {
    const openReqs: ViewerRequest[] = [];
    const fulfilled: ViewerRequest[] = [];
    const dismissed: ViewerRequest[] = [];
    for (const r of viewerRequests) {
      if (r.status === "open") openReqs.push(r);
      else if (r.status === "fulfilled") fulfilled.push(r);
      else dismissed.push(r);
    }
    const byDay = (a: ViewerRequest, b: ViewerRequest) => b.createdDay - a.createdDay;
    openReqs.sort(byDay);
    fulfilled.sort(byDay);
    dismissed.sort(byDay);
    return { openReqs, fulfilled, dismissed };
  }, [viewerRequests]);

  if (!open) return null;

  const openCount = openReqs.length;

  return (
    <div className="modal" onClick={() => close(false)}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>📋 Viewer Requests</h2>
          <button className="modal__close" type="button" onClick={() => close(false)}>✕</button>
        </div>

        <p className="hint">
          Viewers ask for things in DMs. Do them on stream, then hit Check completed to collect rewards.
        </p>

        <div className="requests__actions">
          <button
            className="btn btn--primary"
            type="button"
            disabled={requestsBusy || resolving || openCount === 0}
            onClick={() => void controller.checkRequestCompletion()}
          >
            {requestsBusy ? "Checking…" : "✔ Check completed"}
          </button>
          {openCount > 0 && (
            <span className="requests__open-count">{openCount} open</span>
          )}
        </div>

        <RequestSection title="Open" empty="No open requests." items={openReqs}>
          {(req) => (
            <RequestRow
              key={req.id}
              req={req}
              handle={roster[req.charId]?.displayName || roster[req.charId]?.handle || "?"}
              onOpenChar={() => openCharacter(req.charId)}
              onDismiss={() => controller.dismissRequest(req.id)}
            />
          )}
        </RequestSection>

        <RequestSection title="Fulfilled" empty="" items={fulfilled}>
          {(req) => (
            <RequestRow
              key={req.id}
              req={req}
              handle={roster[req.charId]?.displayName || roster[req.charId]?.handle || "?"}
              onOpenChar={() => openCharacter(req.charId)}
              fulfilled
            />
          )}
        </RequestSection>

        <RequestSection title="Dismissed" empty="" items={dismissed}>
          {(req) => (
            <RequestRow
              key={req.id}
              req={req}
              handle={roster[req.charId]?.displayName || roster[req.charId]?.handle || "?"}
              onOpenChar={() => openCharacter(req.charId)}
              dismissed
            />
          )}
        </RequestSection>
      </div>
    </div>
  );
}

function RequestSection({
  title,
  empty,
  items,
  children,
}: {
  title: string;
  empty: string;
  items: ViewerRequest[];
  children: (req: ViewerRequest) => ReactNode;
}) {
  if (!items.length) {
    if (!empty) return null;
    return (
      <section className="requests__section">
        <h3 className="requests__section-title">{title}</h3>
        <p className="hint">{empty}</p>
      </section>
    );
  }
  return (
    <section className="requests__section">
      <h3 className="requests__section-title">{title}</h3>
      <div className="requests__list">{items.map(children)}</div>
    </section>
  );
}

function RequestRow({
  req,
  handle,
  onOpenChar,
  onDismiss,
  fulfilled,
  dismissed,
}: {
  req: ViewerRequest;
  handle: string;
  onOpenChar: () => void;
  onDismiss?: () => void;
  fulfilled?: boolean;
  dismissed?: boolean;
}) {
  const difficulty = useStore((s) => s.settings.difficulty ?? "normal");
  return (
    <div className={`goal requests__row ${fulfilled ? "requests__row--done" : ""} ${dismissed ? "requests__row--muted" : ""}`}>
      <div className="goal__top">
        <button type="button" className="requests__handle chiplink" onClick={onOpenChar}>
          @{handle}
        </button>
        <span className="requests__reward">{rewardLabel(req, difficulty)}</span>
        <span className="goal__value">Day {req.createdDay}</span>
      </div>
      <p className="requests__ask">{req.ask}</p>
      {fulfilled && req.evidence && (
        <p className="requests__evidence">{req.evidence}</p>
      )}
      {fulfilled && req.fulfilledDay != null && (
        <span className="requests__meta">✓ Fulfilled day {req.fulfilledDay}</span>
      )}
      {onDismiss && (
        <button type="button" className="btn btn--sm" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
