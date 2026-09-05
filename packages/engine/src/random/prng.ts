export const RNG_ALGORITHM = "xorshift32-v1" as const;

export interface RandomState {
  readonly algorithm: typeof RNG_ALGORITHM;
  readonly state: number;
}

export interface RandomDraw {
  readonly value: number;
  readonly nextState: RandomState;
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const normalized = hash >>> 0;
  return normalized === 0 ? 0x6d2b79f5 : normalized;
}

export function createRandomState(seed: string): RandomState {
  if (seed.length === 0) {
    throw new RangeError("seed must not be empty");
  }
  return { algorithm: RNG_ALGORITHM, state: hashSeed(seed) };
}

export function drawUint32(random: RandomState): RandomDraw {
  let state = random.state >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  const next = state >>> 0;
  return {
    value: next,
    nextState: { algorithm: RNG_ALGORITHM, state: next },
  };
}

export function drawUnitInterval(random: RandomState): RandomDraw {
  const draw = drawUint32(random);
  return {
    value: draw.value / 0x1_0000_0000,
    nextState: draw.nextState,
  };
}
