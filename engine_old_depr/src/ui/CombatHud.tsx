import type { CombatState } from "../rules/combat/tickModel";

type Props = {
  combat: CombatState | null;
  onAttack: () => void;
  onWait: () => void;
};

export function CombatHud({ combat, onAttack, onWait }: Props) {
  return (
    <section className="panel">
      <h2>Combat</h2>
      {!combat ? (
        <p>No active combat.</p>
      ) : (
        <>
          <div className="combatActors">
            {combat.actors.map((actor) => (
              <div key={actor.id} className="combatActor">
                <strong>{actor.name}</strong>
                <div>
                  HP: {actor.hp}/{actor.hpMax}
                </div>
              </div>
            ))}
          </div>
          <div className="combatActions">
            <button type="button" onClick={onAttack}>
              Attack
            </button>
            <button type="button" onClick={onWait}>
              Wait
            </button>
          </div>
          <div className="combatLog">
            {combat.log.slice(-5).map((line, index) => (
              <p key={`${line}-${index}`}>{line}</p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
