import type { Character } from "../state/store";
import type { IndexedWorld } from "../world/indexer";
import type { WorldNpc } from "../schema/worldSchema";

type Props = {
  character: Character | null;
  world: IndexedWorld;
  playerPartyNpcIds: string[];
  onOpenCharacter: () => void;
};

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
}

function PartyRow({ npcId, npc }: { npcId: string; npc: WorldNpc }) {
  const name = npc.name?.trim() || npcId;
  const portrait = npc.portrait?.trim();
  const subtitle =
    npc.type?.trim() ||
    (npc.currentLocation ? `Near ${npc.currentLocation}` : "") ||
    "";

  return (
    <li className="sideRail__partyRow">
      <div className="sideRail__partyAvatar" aria-hidden="true">
        {portrait && (portrait.startsWith("http") || portrait.startsWith("data:")) ? (
          <img src={portrait} alt="" />
        ) : (
          <span>{initialsFromName(name)}</span>
        )}
      </div>
      <div className="sideRail__partyText">
        <strong>{name}</strong>
        {subtitle ? <span className="sideRail__partyMeta">{subtitle}</span> : null}
      </div>
    </li>
  );
}

/**
 * Hero summary + companion rows in the right rail — one visual “ledger” for
 * the player’s party (hero + traveling world NPCs).
 */
export function SideRailCharacterLedger({
  character,
  world,
  playerPartyNpcIds,
  onOpenCharacter,
}: Props) {
  const partyRows = playerPartyNpcIds
    .map((id) => {
      const npc = world.world.npcs[id];
      return npc ? { npcId: id, npc } : null;
    })
    .filter((x): x is { npcId: string; npc: WorldNpc } => x !== null);

  const partyBlock =
    partyRows.length === 0 ? (
      <p className="sideRail__partyEmpty">
        Party: you alone for now — companions join through the story.
      </p>
    ) : (
      <>
        <div className="sideRail__ledgerDivider" aria-hidden="true" />
        <h3 className="sideRail__partyHeading">Your party</h3>
        <ul className="sideRail__partyList">
          {partyRows.map(({ npcId, npc }) => (
            <PartyRow key={npcId} npcId={npcId} npc={npc} />
          ))}
        </ul>
      </>
    );

  if (!character) {
    return (
      <section className="sideRail__card sideRail__card--ledger">
        <h2>Character</h2>
        <p className="sideRail__hint">No character yet.</p>
        <button type="button" onClick={onOpenCharacter} style={{ marginTop: 6 }}>
          Create one
        </button>
        {partyBlock}
      </section>
    );
  }

  return (
    <section className="sideRail__card sideRail__card--ledger">
      <div
        className="sideRail__ledgerHero sideRail__card--character"
        onClick={onOpenCharacter}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenCharacter();
          }
        }}
      >
        <div className="sideRail__charRow">
          <div className="sideRail__charAvatar">
            {character.portraitDataUrl ? (
              <img
                src={character.portraitDataUrl}
                alt={`${character.name} portrait`}
              />
            ) : (
              <span aria-hidden="true">{initialsFromName(character.name || "?")}</span>
            )}
          </div>
          <div className="sideRail__charText">
            <strong>{character.name || "Unnamed"}</strong>
            {character.background ? (
              <p>
                {character.background.slice(0, 140)}
                {character.background.length > 140 ? "…" : ""}
              </p>
            ) : (
              <p className="sideRail__hint">(no background written)</p>
            )}
          </div>
        </div>
      </div>
      <div className="sideRail__ledgerParty" role="region" aria-label="Traveling companions">
        {partyBlock}
      </div>
    </section>
  );
}
