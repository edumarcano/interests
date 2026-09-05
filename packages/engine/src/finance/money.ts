declare const centsBrand: unique symbol;
declare const basisPointsBrand: unique symbol;

export type Cents = number & { readonly [centsBrand]: "Cents" };
export type BasisPoints = number & {
  readonly [basisPointsBrand]: "BasisPoints";
};

function requireSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
  return value;
}

export function cents(value: number): Cents {
  return requireSafeInteger(value, "cents") as Cents;
}

export function nonNegativeCents(value: number): Cents {
  const c = cents(value);
  if (c < 0) {
    throw new RangeError("cents must be non-negative");
  }
  return c;
}

export function isSafeCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function isNonNegativeCents(value: unknown): value is Cents {
  return isSafeCents(value) && value >= 0;
}

export function basisPoints(value: number): BasisPoints {
  return requireSafeInteger(value, "basis points") as BasisPoints;
}

export function addCents(left: Cents, right: Cents): Cents {
  if (right > 0 && left > Number.MAX_SAFE_INTEGER - right) {
    throw new RangeError("cents addition overflowed safe integer range");
  }
  if (right < 0 && left < Number.MIN_SAFE_INTEGER - right) {
    throw new RangeError("cents addition underflowed safe integer range");
  }
  return cents(left + right);
}

export function subtractCents(left: Cents, right: Cents): Cents {
  if (right < 0 && left > Number.MAX_SAFE_INTEGER + right) {
    throw new RangeError("cents subtraction overflowed safe integer range");
  }
  if (right > 0 && left < Number.MIN_SAFE_INTEGER + right) {
    throw new RangeError("cents subtraction underflowed safe integer range");
  }
  return cents(left - right);
}
