export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function productImageError(type: string, size: number): string | null {
  if (!PRODUCT_IMAGE_TYPES.includes(type as (typeof PRODUCT_IMAGE_TYPES)[number])) {
    return "Выберите изображение в формате JPG, PNG или WebP.";
  }
  if (size > PRODUCT_IMAGE_MAX_BYTES) return "Размер изображения не должен превышать 5 МБ.";
  return null;
}
