import type { ButtonHTMLAttributes, ReactNode } from "react";
import { pickClass } from "./pickClass";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  children: ReactNode;
};

/** Selectable option card — use in tier grids, preset lists, gender row, etc. */
export function OptionPick({ selected, className, children, type = "button", ...rest }: Props) {
  return (
    <button type={type} className={pickClass(selected, className)} {...rest}>
      {children}
    </button>
  );
}
