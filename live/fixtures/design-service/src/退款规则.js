export function refundableCents(paid, refunded) {
  if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(refunded) || paid < refunded || refunded < 0) {
    throw new RangeError('Invalid refund balance');
  }
  return paid - refunded;
}
