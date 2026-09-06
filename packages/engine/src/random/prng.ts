export const RNG_ALGORITHM_V1 = "xorshift32-v1" as const;
export const RNG_ALGORITHM_V2 = "xorshift32-v2" as const;
export const RNG_ALGORITHM = RNG_ALGORITHM_V2;

export type RngAlgorithm = typeof RNG_ALGORITHM_V1 | typeof RNG_ALGORITHM_V2;

export interface RandomState {
  readonly algorithm: RngAlgorithm;
  readonly state: number;
}

export interface RandomDraw {
  readonly value: number;
  readonly nextState: RandomState;
}

export function isValidRandomState(random: unknown): random is RandomState {
  if (typeof random !== "object" || random === null) {
    return false;
  }
  const candidate = random as {
    readonly algorithm?: unknown;
    readonly state?: unknown;
  };
  if (
    candidate.algorithm !== RNG_ALGORITHM_V1 &&
    candidate.algorithm !== RNG_ALGORITHM_V2
  ) {
    return false;
  }
  return (
    typeof candidate.state === "number" &&
    Number.isInteger(candidate.state) &&
    candidate.state >= 1 &&
    candidate.state <= 0xffffffff
  );
}

export function assertValidRandomState(random: RandomState): void {
  if (
    random.algorithm !== RNG_ALGORITHM_V1 &&
    random.algorithm !== RNG_ALGORITHM_V2
  ) {
    throw new RangeError(
      `unsupported RNG algorithm: ${String(random.algorithm)}`,
    );
  }
  if (
    typeof random.state !== "number" ||
    !Number.isInteger(random.state) ||
    random.state < 1 ||
    random.state > 0xffffffff
  ) {
    throw new RangeError(
      "random state must be an integer within [1, 0xffffffff]",
    );
  }
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

export function createRandomState(
  seed: string,
  algorithm: RngAlgorithm = RNG_ALGORITHM,
): RandomState {
  if (seed.length === 0) {
    throw new RangeError("seed must not be empty");
  }
  if (algorithm !== RNG_ALGORITHM_V1 && algorithm !== RNG_ALGORITHM_V2) {
    throw new RangeError(`unsupported RNG algorithm: ${String(algorithm)}`);
  }
  return { algorithm, state: hashSeed(seed) };
}

export function drawUint32(random: RandomState): RandomDraw {
  assertValidRandomState(random);
  let state = random.state;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  const next = state >>> 0;
  return {
    value: next,
    nextState: { algorithm: random.algorithm, state: next },
  };
}

export function drawUnitInterval(random: RandomState): RandomDraw {
  const draw = drawUint32(random);
  return {
    value: draw.value / 0x1_0000_0000,
    nextState: draw.nextState,
  };
}

/**
 * Legacy v1 bounded integer draw preserving earlier 2^32 sampling assumption.
 * Used for deterministic replay compatibility with explicit xorshift32-v1 state.
 */
function drawBoundedIntV1Legacy(
  random: RandomState,
  bound: number,
): RandomDraw {
  if (!Number.isSafeInteger(bound) || bound <= 0 || bound > 0x1_0000_0000) {
    throw new RangeError(
      "bound must be a positive safe integer within 32-bit range",
    );
  }
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % bound);
  let current = random;
  while (true) {
    const draw = drawUint32(current);
    current = draw.nextState;
    if (draw.value < limit) {
      return {
        value: draw.value % bound,
        nextState: current,
      };
    }
  }
}

/**
 * Corrected v2 bounded integer draw.
 * Valid non-zero xorshift32 domain has 0xffffffff (4,294,967,295) states.
 * Remaps raw draw in [1, 0xffffffff] to sample in [0, 0xffffffff - 1].
 */
function drawBoundedIntV2(random: RandomState, bound: number): RandomDraw {
  if (!Number.isSafeInteger(bound) || bound < 1 || bound > 0xffffffff) {
    throw new RangeError("bound must be an integer within [1, 0xffffffff]");
  }
  const DOMAIN_SIZE = 0xffffffff;
  const limit = DOMAIN_SIZE - (DOMAIN_SIZE % bound);
  let current = random;
  while (true) {
    const draw = drawUint32(current);
    current = draw.nextState;
    const sample = draw.value - 1;
    if (sample < limit) {
      return {
        value: sample % bound,
        nextState: current,
      };
    }
  }
}

/**
 * Draw an integer uniformly at random from [0, bound - 1]
 * using rejection sampling to eliminate modulo bias.
 */
export function drawBoundedInt(random: RandomState, bound: number): RandomDraw {
  assertValidRandomState(random);
  if (random.algorithm === RNG_ALGORITHM_V1) {
    return drawBoundedIntV1Legacy(random, bound);
  }
  return drawBoundedIntV2(random, bound);
}
