import type { ComponentType } from "react";
import type { TemplateId } from "../sceneSpec";

export type TemplateProps = {
  position: [number, number, number];
  rotation?: number;
  scale?: number;
  palette: string[];
  materialOverride?: string;
  label?: string;
};

export type TemplateComponent = ComponentType<TemplateProps>;

export type TemplateRegistry = Record<TemplateId, TemplateComponent>;

export function colorAt(palette: string[], index: number): string {
  if (palette.length === 0) {
    return "#888888";
  }
  return palette[index % palette.length];
}
