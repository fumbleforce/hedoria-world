import { GENDER_OPTIONS, genderMode } from "../game/gender";
import { OptionPick } from "./OptionPick";

type Props = {
  gender: string;
  onChange: (gender: string) => void;
  customPlaceholder?: string;
};

/** Male / female / custom gender selector (settings + onboarding). */
export function GenderPicker({ gender, onChange, customPlaceholder }: Props) {
  const mode = genderMode(gender);

  return (
    <>
      <div className="genderRow">
        {GENDER_OPTIONS.map((opt) => (
          <OptionPick
            key={opt.id}
            selected={mode === opt.id}
            onClick={() => {
              if (opt.id === "custom") onChange(mode === "custom" ? gender : "");
              else onChange(opt.id);
            }}
          >
            <b>{opt.label}</b>
          </OptionPick>
        ))}
      </div>
      {mode === "custom" && (
        <input
          style={{ marginTop: 8 }}
          value={gender}
          placeholder={customPlaceholder ?? "e.g. nonbinary, androgynous…"}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </>
  );
}
