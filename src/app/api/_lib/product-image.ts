import { PRODUCT_IMAGE_TYPES, PRODUCT_IMAGE_MAX_BYTES } from "@/domain/product-image-constants";

const signatures: Record<(typeof PRODUCT_IMAGE_TYPES)[number], (data: Buffer) => boolean> = {
  "image/png": (data) => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  "image/webp": (data) => data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP",
};

export async function readProductImage(formData: FormData) {
  const value = formData.get("image");
  if (value === null || typeof value === "string" || value.size === 0) return null;
  if (value.size > PRODUCT_IMAGE_MAX_BYTES) throw new Error("Размер изображения не должен превышать 5 МБ.");
  if (!PRODUCT_IMAGE_TYPES.includes(value.type as (typeof PRODUCT_IMAGE_TYPES)[number])) {
    throw new Error("Выберите изображение в формате JPG, PNG или WebP.");
  }
  const data = Buffer.from(await value.arrayBuffer());
  const isValidImage = signatures[value.type as (typeof PRODUCT_IMAGE_TYPES)[number]](data);
  if (!isValidImage) throw new Error("Файл не похож на изображение выбранного формата.");
  return { data, contentType: value.type };
}
