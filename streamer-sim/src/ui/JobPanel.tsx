import { useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import {
  JOB_PRESETS,
  MAX_STRIKES,
  SHIFT_SLOT_ORDER,
  SHIFT_SLOTS,
  canClockInToday,
  shiftStatus,
  shiftStatusLabel,
  shiftWindowLabel,
  workedToday,
  type JobPreset,
  type ShiftSlotId,
} from "../game/jobs";
import { formatClock } from "../game/time";

type PendingApply =
  | { kind: "preset"; preset: JobPreset; label: string }
  | { kind: "custom"; title: string; wage: number; slot: ShiftSlotId; label: string };

/** Job board + current shift status / clock-in. */
export function JobPanel({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.jobPanelOpen);
  const close = useStore((s) => s.setJobPanelOpen);
  const job = useStore((s) => s.job);
  const clock = useStore((s) => s.clock);
  const day = useStore((s) => s.metrics.day);
  const isLive = useStore((s) => s.session.isLive);
  const resolving = useStore((s) => s.resolving);

  const [customTitle, setCustomTitle] = useState("");
  const [customWage, setCustomWage] = useState("65");
  const [customSlot, setCustomSlot] = useState<ShiftSlotId>("afternoon");
  const [pending, setPending] = useState<PendingApply | null>(null);

  if (!open) return null;

  const todayWorked = job ? workedToday(job, day) : false;
  const status = job ? shiftStatus(job, clock) : null;
  const canWork = !!job && !isLive && !resolving && canClockInToday(job, clock, day);

  const todayLabel = job
    ? todayWorked
      ? job.lastClockInOnTime ? "Worked today (on time)" : "Worked today (late)"
      : shiftStatusLabel(status!)
    : "";

  const requestApply = (p: PendingApply) => {
    if (isLive) return;
    if (job) setPending(p);
    else confirmApply(p);
  };

  const confirmApply = (p: PendingApply) => {
    if (p.kind === "preset") controller.applyForJob(p.preset);
    else controller.applyForCustomJob(p.title, p.wage, p.slot);
    setPending(null);
  };

  const requestCustom = () => {
    const wage = Number.parseInt(customWage, 10);
    const safeWage = Number.isFinite(wage) ? wage : 65;
    const label = customTitle.trim() || "Side gig";
    requestApply({ kind: "custom", title: customTitle, wage: safeWage, slot: customSlot, label });
  };

  return (
    <div className="modal" onClick={() => close(false)}>
      <div className="modal__card modal__card--wide jobpanel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>💼 Day job</h2>
          <button className="modal__close" type="button" onClick={() => close(false)}>✕</button>
        </div>

        <p className="hint jobpanel__intro">
          A day job pays the bills while you grow the channel. One shift a day — show up on time, or
          rack up strikes. Three bad days in a row and you&apos;re fired.
        </p>

        {isLive && <p className="hint warn">End the stream before applying or clocking in.</p>}

        {job ? (
          <section className="jobpanel__current">
            <div className="jobpanel__currentHead">
              <div>
                <span className="jobpanel__eyebrow">Current job</span>
                <b className="jobpanel__role">{job.title}</b>
              </div>
              <span className={`jobpanel__strikes ${job.strikes >= 2 ? "is-warn" : ""}`}>
                {job.strikes}/{MAX_STRIKES} strikes
              </span>
            </div>
            <dl className="jobpanel__facts">
              <div><dt>Pay</dt><dd>${job.wage}/shift</dd></div>
              <div><dt>Shift</dt><dd>{shiftWindowLabel(job)}</dd></div>
              <div><dt>Today</dt><dd>{todayLabel}</dd></div>
            </dl>
            <div className="jobpanel__actions">
              <button
                className="btn btn--primary"
                type="button"
                disabled={!canWork}
                onClick={() => controller.goToWork()}
              >
                {status === "late" ? "Clock in (late)" : "Clock in"}
              </button>
              <button
                className="btn"
                type="button"
                disabled={isLive || resolving}
                onClick={() => controller.quitJob()}
              >
                Quit job
              </button>
            </div>
            {!canWork && !todayWorked && status === "early" && (
              <p className="hint jobpanel__note">Shift opens at {formatClock(job.shiftStart)} — come back then.</p>
            )}
            {!canWork && !todayWorked && status === "over" && (
              <p className="hint warn jobpanel__note">You missed today&apos;s shift — that&apos;s a strike at bedtime.</p>
            )}
            {todayWorked && (
              <p className="hint jobpanel__note">Done for the day. Next shift is tomorrow.</p>
            )}
          </section>
        ) : (
          <p className="hint jobpanel__none">No job right now — pick one from the board below.</p>
        )}

        <hr className="rule" />

        <section className="jobpanel__section">
          <h3 className="jobpanel__h3">Job board</h3>
          <p className="hint">Applying eats an unpredictable chunk of your day, and replaces any current job.</p>
          <div className="jobpanel__grid">
            {JOB_PRESETS.map((p) => {
              const isCurrent = job?.id === p.id;
              return (
                <div key={p.id} className={`jobcard ${isCurrent ? "is-current" : ""}`}>
                  <div className="jobcard__head">
                    <b>{p.title}</b>
                    <span className="jobcard__wage">${p.wage}</span>
                  </div>
                  <span className="jobcard__shift">{shiftWindowLabel(p)}</span>
                  <p className="jobcard__blurb">{p.blurb}</p>
                  <button
                    className="btn btn--mini"
                    type="button"
                    disabled={isLive || resolving || isCurrent}
                    onClick={() => requestApply({ kind: "preset", preset: p, label: p.title })}
                  >
                    {isCurrent ? "Current job" : "Apply"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <hr className="rule" />

        <section className="jobpanel__section">
          <h3 className="jobpanel__h3">Invent a job</h3>
          <div className="jobpanel__customGrid">
            <label className="field">
              <span>Title</span>
              <input
                value={customTitle}
                placeholder="e.g. Night receptionist"
                onChange={(e) => setCustomTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Salary / shift ($)</span>
              <input
                type="number"
                min={40}
                max={120}
                value={customWage}
                onChange={(e) => setCustomWage(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Shift hours</span>
              <select value={customSlot} onChange={(e) => setCustomSlot(e.target.value as ShiftSlotId)}>
                {SHIFT_SLOT_ORDER.map((id) => (
                  <option key={id} value={id}>{SHIFT_SLOTS[id].label}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="btn btn--primary"
            type="button"
            disabled={isLive || resolving}
            onClick={requestCustom}
          >
            Apply for this job
          </button>
        </section>
      </div>

      {pending && (
        <div className="modal" onClick={() => setPending(null)}>
          <div className="modal__card jobconfirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>Change job?</h2>
              <button className="modal__close" type="button" onClick={() => setPending(null)}>✕</button>
            </div>
            <p>
              Applying for <b>{pending.label}</b> means quitting <b>{job?.title}</b> right now.
            </p>
            <p className="hint">
              Job hunting takes an unpredictable amount of time — you won&apos;t know how long until
              you&apos;re hired, and the rest of your day may be gone.
            </p>
            <div className="jobconfirm__actions">
              <button className="btn" type="button" onClick={() => setPending(null)}>Cancel</button>
              <button className="btn btn--primary" type="button" onClick={() => confirmApply(pending)}>
                Quit &amp; apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
