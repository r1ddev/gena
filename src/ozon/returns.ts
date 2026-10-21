export function chooseReturnPostingNumber(
  incomingPostingNumber: string | null,
  existingPostingNumber: string | null,
  matchesReturnedProduct: (postingNumber: string) => boolean,
  preserveExisting = false,
): string | null {
  if (preserveExisting) return existingPostingNumber;
  if (incomingPostingNumber && matchesReturnedProduct(incomingPostingNumber)) return incomingPostingNumber;
  if (existingPostingNumber && matchesReturnedProduct(existingPostingNumber)) return existingPostingNumber;
  return incomingPostingNumber;
}
