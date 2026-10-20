export type StocktakeImportLine = {
  productId: string;
  expected: number;
  actual: number;
  source: string;
  rowId: string;
};

export type StocktakeWarehouseIdentity = {
  rowId: string;
  identity: string;
  warehouse: "seller" | "ozon" | null;
  explicitWarehouse: boolean;
};

export function getAmbiguousStocktakeWarehouseRows(rows: StocktakeWarehouseIdentity[]) {
  const byIdentity = new Map<string, StocktakeWarehouseIdentity[]>();
  for (const row of rows) byIdentity.set(row.identity, [...(byIdentity.get(row.identity) ?? []), row]);
  const ambiguous = new Set<string>();
  for (const group of byIdentity.values()) {
    const warehouses = new Set(group.flatMap((row) => row.warehouse ? [row.warehouse] : []));
    if (warehouses.size > 1 && group.some((row) => !row.explicitWarehouse)) {
      for (const row of group) ambiguous.add(row.rowId);
    }
  }
  return ambiguous;
}

export function uniqueStocktakeLines(lines: StocktakeImportLine[]) {
  const byProduct = new Map<string, StocktakeImportLine[]>();
  for (const line of lines) byProduct.set(line.productId, [...(byProduct.get(line.productId) ?? []), line]);

  const accepted: StocktakeImportLine[] = [];
  const conflicts: { productId: string; rows: StocktakeImportLine[] }[] = [];
  for (const [productId, rows] of byProduct) {
    const first = rows[0];
    if (rows.every((row) => row.expected === first.expected && row.actual === first.actual)) accepted.push(first);
    else conflicts.push({ productId, rows });
  }

  return { lines: accepted, conflicts };
}
