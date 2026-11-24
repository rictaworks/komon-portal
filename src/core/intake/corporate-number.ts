const SHAPE = /^[0-9]{13}$/;

/**
 * Validates a Japanese corporate number: 13 digits whose first digit is the check digit
 * 9 - ((sum of P(n) * Q(n) for n = 1..12) mod 9), Q(n) = 1 for odd n and 2 for even n,
 * n counted from the rightmost digit.
 */
export function isValidCorporateNumber(value: string): boolean {
  if (!SHAPE.test(value)) {
    return false;
  }
  const digits = [...value].map(Number);
  const body = digits.slice(1).reverse();
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 2), 0);
  return digits[0] === 9 - (sum % 9);
}
