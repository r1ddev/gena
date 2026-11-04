import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { financeAccruals, productLinks, supplies, supplyLines } from "@/db/schema";

type SupplyRecord = {
  id: string;
  note: string;
  marketplace: string;
  ozonSupplyId: string | null;
  sourceKey: string | null;
  ozonSkus: Set<string>;
};

type OzonSupplyCharge = {
  unitNumber: string;
  amount: Decimal;
  relatedSkus: Set<string>;
};

function platformFromNote(note: string) {
  if (/\b(?:WB|Wildberries)\b/i.test(note)) return "wb";
  if (/\bAvito\b|Авито/i.test(note)) return "avito";
  return null;
}

function explicitOzonSupplyId(note: string) {
  return note.match(/(?:номер\s+поставки\s+Ozon|Ozon\s+ID)\s*[:№#]?\s*(\d{12,16})/i)?.[1] ?? null;
}

function postNumber(note: string) {
  const value = note.match(/номер\s+поста\s*[:№#]?\s*(\d{1,16})/i)?.[1];
  return value ?? null;
}

function skusMatch(supplySkus: Set<string>, financeSkus: Set<string>) {
  if (!supplySkus.size && !financeSkus.size) return true;
  if (!supplySkus.size || !financeSkus.size) return false;
  return [...supplySkus].some((sku) => financeSkus.has(sku));
}

function supplyMatchesCharge(supply: SupplyRecord, charge: OzonSupplyCharge) {
  if (supply.marketplace !== "ozon" && supply.marketplace !== "unknown") return false;

  if (supply.ozonSupplyId) return supply.ozonSupplyId === charge.unitNumber;
  const idInNote = explicitOzonSupplyId(supply.note);
  if (idInNote) return idInNote === charge.unitNumber;

  const post = postNumber(supply.note)
    ?? (supply.marketplace === "ozon" && /^\d{1,16}$/.test(supply.note.trim()) ? supply.note.trim() : null);
  return Boolean(post && charge.unitNumber.endsWith(post) && skusMatch(supply.ozonSkus, charge.relatedSkus));
}

export async function reconcileOzonSupplyCosts() {
  const [headerRows, lineRows, chargeRows] = await Promise.all([
    db.select({ id: supplies.id, note: supplies.note, marketplace: supplies.marketplace, ozonSupplyId: supplies.ozonSupplyId, sourceKey: supplies.sourceKey }).from(supplies),
    db.select({ supplyId: supplyLines.supplyId, ozonSku: productLinks.ozonSku })
      .from(supplyLines)
      .leftJoin(productLinks, eq(productLinks.productId, supplyLines.productId)),
    db.select({
      unitNumber: sql<string>`${financeAccruals.raw}->>'unit_number'`,
      amount: financeAccruals.amount,
      relatedSkus: financeAccruals.relatedSkus,
    })
      .from(financeAccruals)
      .where(and(eq(financeAccruals.accruedCategory, "NON_ITEM"), eq(financeAccruals.typeId, "12"))),
  ]);

  const suppliesById = new Map<string, SupplyRecord>();
  for (const row of headerRows) {
    const inferredMarketplace = row.marketplace === "unknown"
      ? platformFromNote(row.note) ?? (row.sourceKey === null ? "ozon" : null)
      : null;
    const record: SupplyRecord = {
      ...row,
      marketplace: inferredMarketplace ?? row.marketplace,
      ozonSkus: new Set(),
    };
    suppliesById.set(row.id, record);
  }
  for (const line of lineRows) {
    if (line.ozonSku) suppliesById.get(line.supplyId)?.ozonSkus.add(line.ozonSku);
  }

  const chargesByUnitNumber = new Map<string, OzonSupplyCharge>();
  for (const row of chargeRows) {
    const unitNumber = row.unitNumber ?? "";
    if (!/^\d{12,16}$/.test(unitNumber)) continue;
    const charge = chargesByUnitNumber.get(unitNumber) ?? {
      unitNumber,
      amount: new Decimal(0),
      relatedSkus: new Set<string>(),
    };
    charge.amount = charge.amount.plus(row.amount);
    for (const sku of row.relatedSkus ?? []) if (sku) charge.relatedSkus.add(sku);
    chargesByUnitNumber.set(unitNumber, charge);
  }

  const candidateIdsByUnit = new Map<string, string[]>();
  let ambiguous = 0;
  for (const charge of chargesByUnitNumber.values()) {
    const matches = [...suppliesById.values()].filter((supply) => supplyMatchesCharge(supply, charge));
    if (matches.length === 1) candidateIdsByUnit.set(charge.unitNumber, [matches[0].id]);
    else if (matches.length > 1) ambiguous += 1;
  }

  const unitNumbersBySupply = new Map<string, string[]>();
  for (const [unitNumber, [supplyId]] of candidateIdsByUnit) {
    unitNumbersBySupply.set(supplyId, [...(unitNumbersBySupply.get(supplyId) ?? []), unitNumber]);
  }

  let matched = 0;
  await db.transaction(async (tx) => {
    for (const [supplyId, unitNumbers] of unitNumbersBySupply) {
      if (unitNumbers.length !== 1) {
        ambiguous += 1;
        continue;
      }
      const unitNumber = unitNumbers[0];
      const charge = chargesByUnitNumber.get(unitNumber)!;
      const cost = charge.amount.negated().toDecimalPlaces(2).toFixed(2);
      await tx.update(supplies)
        .set({ marketplace: "ozon", ozonSupplyId: unitNumber, shippingCost: cost })
        .where(eq(supplies.id, supplyId));
      matched += 1;
    }

    for (const supply of headerRows) {
      if (supply.marketplace !== "unknown") continue;
      const inferredMarketplace = platformFromNote(supply.note) ?? (supply.sourceKey === null ? "ozon" : null);
      if (!inferredMarketplace) continue;
      await tx.update(supplies).set({ marketplace: inferredMarketplace }).where(eq(supplies.id, supply.id));
    }
  });

  return {
    matchedSupplies: matched,
    unmatchedOzonCharges: chargesByUnitNumber.size - candidateIdsByUnit.size,
    ambiguousSupplies: ambiguous,
  };
}
