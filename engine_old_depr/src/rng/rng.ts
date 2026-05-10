import seedrandom from "seedrandom";

export class DeterministicRng {
  private readonly rng: seedrandom.PRNG;

  constructor(seed: string) {
    this.rng = seedrandom(seed);
  }

  next(): number {
    return this.rng.quick();
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from empty array");
    }
    return items[this.int(0, items.length - 1)];
  }

  child(namespace: string): DeterministicRng {
    const childSeed = `${namespace}:${Math.floor(this.next() * 1e9)}`;
    return new DeterministicRng(childSeed);
  }
}
