import { useMemo } from "react";
import { useStore } from "../state/store";
import type { IndexedWorld } from "../world/indexer";
import type { WorldNarrator } from "../dialogue/worldNarrator";
import { ActionPrompt } from "./ActionPrompt";

type Props = {
  world: IndexedWorld;
  worldNarrator: WorldNarrator;
};

/**
 * Fullscreen RPG-style dialogue overlay. Shown when the active
 * engagement group is `engaged` or `locked`. Player can speak via the
 * regular `ActionPrompt` (free-text intent) OR use the quick-action
 * buttons at the foot; both go through the same WorldNarrator so the
 * streaming narration + tool-call pipeline is unchanged.
 */
export function DialogueOverlay({ world, worldNarrator }: Props) {
  const activeDialogueGroupId = useStore((s) => s.activeDialogueGroupId);
  const activeDialogueStartIndex = useStore(
    (s) => s.activeDialogueStartIndex,
  );
  const engagement = useStore((s) => s.engagement);
  const storyLog = useStore((s) => s.storyLog);
  const character = useStore((s) => s.character);
  const pendingNarrationText = useStore((s) => s.pendingNarrationText);
  const playerConditions = useStore((s) => s.playerConditions);

  const group = activeDialogueGroupId
    ? engagement.groups[activeDialogueGroupId]
    : undefined;

  // Render the conversation as a unified view of the story log scoped
  // to the current engagement: the player's typed/clicked intent lines
  // ("You ask Saska about the road north."), the narrator's prose
  // beats ("She looks past you, into the dust.") and the NPC's spoken
  // lines via `say` — woven together in chronological order. The old
  // `dialogue` array only held NPC speech, which made the overlay feel
  // like a one-sided monologue.
  const conversation = useMemo(() => {
    const startIndex = activeDialogueStartIndex ?? storyLog.length;
    return storyLog.slice(startIndex);
  }, [storyLog, activeDialogueStartIndex]);
  const show = Boolean(
    group && (group.state === "engaged" || group.state === "locked"),
  );
  const npcName = group?.name ?? "Unknown";
  const npcPortrait = useMemo(() => {
    if (!group) return "";
    for (const id of group.npcIds) {
      const npc = world.world.npcs[id];
      if (npc?.portrait) return npc.portrait;
    }
    return "";
  }, [group, world.world.npcs]);

  if (!show || !group) return null;

  const locked = group.state === "locked";

  return (
    <div className="dialogueOverlay">
      <div className="dialogueOverlay__panel">
        <header className="dialogueOverlay__header">
          <h2>Dialogue</h2>
          <span>
            {npcName}
            {locked ? " · locked" : ""}
          </span>
        </header>

        <div className="dialogueOverlay__portraits">
          <figure className="dialogueOverlay__portraitCard">
            {npcPortrait ? (
              <img src={npcPortrait} alt={`${npcName} portrait`} />
            ) : (
              <div className="dialogueOverlay__portraitFallback">
                {npcName.slice(0, 2)}
              </div>
            )}
            <figcaption>{npcName}</figcaption>
            {group.summary ? (
              <p className="dialogueOverlay__summary">{group.summary}</p>
            ) : null}
          </figure>
          <figure className="dialogueOverlay__portraitCard">
            {character?.portraitDataUrl ? (
              <img
                src={character.portraitDataUrl}
                alt={`${character.name} portrait`}
              />
            ) : (
              <div className="dialogueOverlay__portraitFallback">
                {(character?.name ?? "You").slice(0, 2)}
              </div>
            )}
            <figcaption>{character?.name ?? "You"}</figcaption>
            {playerConditions.length > 0 ? (
              <ul className="dialogueOverlay__conditions">
                {playerConditions.map((c) => (
                  <li
                    key={c.id}
                    className="dialogueOverlay__conditionPill"
                    title={`${c.severity}${c.notes ? ` — ${c.notes}` : ""}${c.effects.length > 0 ? ` (${c.effects.join("; ")})` : ""}`}
                  >
                    {c.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </figure>
        </div>

        <ol className="dialogueOverlay__log">
          {conversation.map((entry) => {
            let label: string;
            let roleClass: string;
            switch (entry.kind) {
              case "player":
                label = character?.name ?? "You";
                roleClass = "player";
                break;
              case "say": {
                const speaker = entry.npcId
                  ? world.world.npcs[entry.npcId]
                  : undefined;
                label = speaker?.name?.trim() || npcName;
                roleClass = "npc";
                break;
              }
              case "error":
                label = "Narrator";
                roleClass = "system";
                break;
              case "system":
                label = "System";
                roleClass = "system";
                break;
              case "narration":
              default:
                label = "Narrator";
                roleClass = "narration";
                break;
            }
            return (
              <li
                key={entry.id}
                className={`dialogueOverlay__line dialogueOverlay__line--${roleClass}`}
              >
                <strong>{label}</strong> <span>{entry.text}</span>
              </li>
            );
          })}
          {pendingNarrationText ? (
            <li className="dialogueOverlay__line dialogueOverlay__line--pending dialogueOverlay__line--narration">
              <strong>Narrator</strong> <span>{pendingNarrationText}</span>
            </li>
          ) : null}
        </ol>

        <div className="dialogueOverlay__actions">
          <button
            type="button"
            onClick={() =>
              void worldNarrator.submitPlayerIntent({
                kind: "scene.button",
                verb: "talk",
                groupId: group.id,
              })
            }
          >
            Talk
          </button>
          <button
            type="button"
            onClick={() =>
              void worldNarrator.submitPlayerIntent({
                kind: "scene.button",
                verb: "trade",
                groupId: group.id,
              })
            }
          >
            Trade
          </button>
          <button
            type="button"
            onClick={() =>
              void worldNarrator.submitPlayerIntent({
                kind: "scene.button",
                verb: "attack",
                groupId: group.id,
              })
            }
          >
            Attack
          </button>
          <button
            type="button"
            disabled={locked}
            title={
              locked ? "You are locked into this scene." : "Leave the dialogue"
            }
            onClick={() =>
              void worldNarrator.submitPlayerIntent({
                kind: "scene.button",
                verb: "leave",
                groupId: group.id,
              })
            }
          >
            Leave
          </button>
        </div>

        <div className="dialogueOverlay__prompt">
          <ActionPrompt worldNarrator={worldNarrator} />
        </div>
      </div>
    </div>
  );
}
