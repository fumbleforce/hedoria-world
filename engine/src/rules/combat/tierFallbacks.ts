export type TierDefaults = {
  attributes: Record<string, number>;
  skillRank: number;
  ac: number;
  attacksPerTurn: number;
  damageDie: string;
};

export const TIER_FALLBACKS: Record<string, TierDefaults> = {
  trivial: {
    attributes: {
      strength: 8,
      dexterity: 8,
      constitution: 8,
      intelligence: 8,
      wisdom: 8,
      charisma: 8,
    },
    skillRank: 1,
    ac: 10,
    attacksPerTurn: 1,
    damageDie: "1d4+0",
  },
  strong: {
    attributes: {
      strength: 12,
      dexterity: 12,
      constitution: 12,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    skillRank: 3,
    ac: 13,
    attacksPerTurn: 1,
    damageDie: "1d8+2",
  },
  elite: {
    attributes: {
      strength: 15,
      dexterity: 14,
      constitution: 14,
      intelligence: 12,
      wisdom: 12,
      charisma: 12,
    },
    skillRank: 5,
    ac: 16,
    attacksPerTurn: 2,
    damageDie: "1d10+4",
  },
  boss: {
    attributes: {
      strength: 18,
      dexterity: 16,
      constitution: 18,
      intelligence: 14,
      wisdom: 14,
      charisma: 14,
    },
    skillRank: 8,
    ac: 18,
    attacksPerTurn: 2,
    damageDie: "2d8+6",
  },
};
