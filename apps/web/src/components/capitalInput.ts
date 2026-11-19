export function scaledInput(
  value: string,
  scale: number,
  precision: number,
): number | null {
  const [whole, fraction = ""] = value.trim().split(".");
  if (
    !/^\d+$/.test(whole ?? "") ||
    !/^\d*$/.test(fraction) ||
    fraction.length > precision ||
    value.split(".").length > 2
  )
    return null;
  const units = Number(whole) * scale + Number(fraction.padEnd(precision, "0"));
  return Number.isSafeInteger(units) && units > 0 ? units : null;
}
