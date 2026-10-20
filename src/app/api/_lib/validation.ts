import { z } from "zod";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Укажите корректную дату.");

export const timestampValue = z.string().datetime({ offset: true });

export const nonNegativeDecimal = z.union([z.string().trim(), z.number().finite()])
  .transform(String)
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, "Значение должно быть неотрицательным числом.");

export const positiveDecimal = z.union([z.string().trim(), z.number().finite()])
  .transform(String)
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Значение должно быть больше нуля.");
