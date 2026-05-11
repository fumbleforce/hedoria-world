import { useState } from "react";
import { useStore } from "../state/store";
import type { WorldNarrator, SceneVerb } from "../dialogue/worldNarrator";
import type { Engagement, EngagementGroup } from "../state/store";
import {
  actionsFor,
  describeLock,
  isPlayerLocked,
  partitionCharactersAndParties,
  sortedGroupsForView,
} from "../scene/engagement";
import { LoadingPill } from "./LoadingPill";

/**
 * The scene-mode UI: NPC group cards with state-aware buttons + an
 * optional combat readout. The free-text action input lives globally
 * in `ActionPrompt` (bottom-centre, always visible), so this view
 * focuses purely on scene-specific affordances. Every interaction
 * still funnels through `worldNarrator.submitPlayerIntent(...)` so the
 * persistent NarrationPanel stays in sync.
 */
type Props = {
  worldNarrator: WorldNarrator;
};

export function SceneView({ worldNarrator }: Props) {
  const [pending, setPending] = useState(false);

  const tile = useStore((s) => s.currentSceneTile);
  const engagement = useStore((s) => s.engagement);
  const combat = useStore((s) => s.combat);

  if (!tile) {
    return (
      <section className="sceneView">
        <header className="sceneView__header">
          <h2>Scene</h2>
        </header>
        <p style={{ color: "var(--fg-2)" }}>You are not in a scene.</p>
      </section>
    );
  }

  const sorted = sortedGroupsForView(engagement);
  const { characters, parties } = partitionCharactersAndParties(sorted);
  const playerLocked = isPlayerLocked(engagement);
  const lock = describeLock(engagement);

  async function submitButton(action: {
    verb: SceneVerb;
    groupId: string;
  }): Promise<void> {
    // Group action buttons need a `pending` guard so a fast double-click
    // can't fire two LLM calls for one intent. Centralising every
    // LLM-touching button through this wrapper keeps the
    // "1 click = 1 round-trip" invariant.
    if (pending) return;
    setPending(true);
    try {
      await worldNarrator.submitPlayerIntent({
        kind: "scene.button",
        verb: action.verb,
        groupId: action.groupId,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="sceneView">
      <header className="sceneView__header">
        <h2>
          Scene <small>· {tile.label ?? tile.kind}</small>
          {pending ? <LoadingPill label="Narrator responding" /> : null}
        </h2>
        <div className="sceneView__lock">
          {playerLocked ? (
            <span className="sceneView__lockBadge">Locked: {lock}</span>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                void worldNarrator.submitPlayerIntent({ kind: "scene.leaveTile" })
              }
            >
              Leave tile
            </button>
          )}
        </div>
      </header>

      <aside className="sceneView__groups">
        <h3 className="sceneView__groupsTitle">Who is here</h3>
        {characters.length === 0 && parties.length === 0 ? (
          <p className="sceneView__hint">
            No one in view. The narrator may add a party on your next action.
          </p>
        ) : (
          <>
            <section className="sceneView__groupSection">
              <h4 className="sceneView__groupHeading">Characters</h4>
              <p className="sceneView__hint sceneView__hint--tight">
                From the world — each stands alone.
              </p>
              {characters.length === 0 ? (
                <p className="sceneView__hint">None on this tile.</p>
              ) : (
                <ul>
                  {characters.map((g) => (
                    <GroupCard
                      key={g.id}
                      g={g}
                      engagement={engagement}
                      pending={pending}
                      onAction={submitButton}
                      badge="Character"
                    />
                  ))}
                </ul>
              )}
            </section>
            <section className="sceneView__groupSection">
              <h4 className="sceneView__groupHeading">Parties</h4>
              <p className="sceneView__hint sceneView__hint--tight">
                Procedural bands — one stranger, 2–3 together, or an unnamed crowd.
              </p>
              {parties.length === 0 ? (
                <p className="sceneView__hint">None right now.</p>
              ) : (
                <ul>
                  {parties.map((g) => (
                    <GroupCard
                      key={g.id}
                      g={g}
                      engagement={engagement}
                      pending={pending}
                      onAction={submitButton}
                      badge={partyBadge(g)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </aside>

      {combat ? (
        <section className="sceneView__combat">
          <h3>Combat (turn {combat.turn})</h3>
          <ul>
            {combat.actors.map((a) => (
              <li key={a.id}>
                {a.name} :: {a.hp}/{a.hpMax}
              </li>
            ))}
          </ul>
          <ul>
            {combat.log.slice(-5).map((line, i) => (
              <li key={`c-${i}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function partyBadge(g: EngagementGroup): string {
  const n = g.npcIds.length;
  if (n === 0) return "Party · crowd";
  if (n === 1) return "Party · lone";
  return `Party · ${n}`;
}

function GroupCard(props: {
  g: EngagementGroup;
  engagement: Engagement;
  pending: boolean;
  onAction: (a: { verb: SceneVerb; groupId: string }) => void;
  badge: string;
}) {
  const { g, engagement, pending, onAction, badge } = props;
  return (
    <li className={`sceneView__group sceneView__group--${g.state}`}>
      <header>
        <strong>{g.name}</strong>
        <span className="sceneView__groupBadge">{badge}</span>
        <span className="sceneView__groupState">{g.state}</span>
      </header>
      {g.npcIds.length > 0 ? (
        <p className="sceneView__npcIds">{g.npcIds.join(" · ")}</p>
      ) : null}
      {g.summary ? <p>{g.summary}</p> : null}
      <div className="sceneView__groupActions">
        {actionsFor(g, engagement).map((verb) => (
          <button
            key={verb}
            type="button"
            disabled={pending}
            onClick={() => void onAction({ verb, groupId: g.id })}
          >
            {labelFor(verb)}
          </button>
        ))}
      </div>
    </li>
  );
}

function labelFor(verb: string): string {
  switch (verb) {
    case "talk":
      return "Talk";
    case "attack":
      return "Attack";
    case "trade":
      return "Trade";
    case "leave":
      return "Leave";
    case "engage":
      return "Engage";
    default:
      return verb;
  }
}
