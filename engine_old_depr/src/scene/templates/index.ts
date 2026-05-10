import type { TemplateId } from "../sceneSpec";
import {
  Bridge,
  DomeHall,
  DoorPortal,
  Fountain,
  GateArch,
  House,
  Lamp,
  PillarCluster,
  Platform,
  Spire,
  Stair,
  Stall,
  Statue,
  Tower,
  WallSection,
} from "./built";
import { Cliff, Crater, MountainSilhouette, Pond, RockCluster, TreeCluster } from "./natural";
import {
  CrystalCluster,
  EnergyConduit,
  Machine,
  Obelisk,
  Pod,
  Pyre,
} from "./special";
import type { TemplateComponent, TemplateProps, TemplateRegistry } from "./types";

export type { TemplateProps, TemplateComponent };

export const TEMPLATE_REGISTRY: TemplateRegistry = {
  "pillar-cluster": PillarCluster,
  tower: Tower,
  spire: Spire,
  "dome-hall": DomeHall,
  house: House,
  stall: Stall,
  bridge: Bridge,
  "gate-arch": GateArch,
  "wall-section": WallSection,
  stair: Stair,
  platform: Platform,
  statue: Statue,
  fountain: Fountain,
  lamp: Lamp,
  "door-portal": DoorPortal,
  "tree-cluster": TreeCluster,
  "rock-cluster": RockCluster,
  cliff: Cliff,
  "mountain-silhouette": MountainSilhouette,
  crater: Crater,
  pond: Pond,
  pod: Pod,
  machine: Machine,
  "crystal-cluster": CrystalCluster,
  "energy-conduit": EnergyConduit,
  obelisk: Obelisk,
  pyre: Pyre,
};

export function getTemplate(id: TemplateId): TemplateComponent {
  const template = TEMPLATE_REGISTRY[id];
  if (!template) {
    throw new Error(`Unknown template id: ${id}`);
  }
  return template;
}
