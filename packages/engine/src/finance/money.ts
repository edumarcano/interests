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

export function basisPoints(value: number): BasisPoints {
  return requireSafeInteger(value, "basis points") as BasisPoints;
}

export function addCents(left: Cents, right: Cents): Cents {
  return cents(left + right);
}

export function subtractCents(left: Cents, right: Cents): Cents {
  return cents(left - right);
}
