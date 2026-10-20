# Editable Purchase Receipts Design

## Status

Conversational design approved. The purchase/receipt structure and cost allocation were clarified by the user on 2026-10-20. This document defines the design; it does not authorize implementation by itself.

## Problem

The current workflow records one receipt as a purchase reference, date, quantity, and comment. A receipt cannot be edited or deleted, and accounting assigns every received unit to the product expected in the purchase. This cannot represent a quantity correction, a replacement product, or a delivery split across several products.

## User-approved decisions

- One purchase record contains one expected product, its ordered quantity, and the total amount paid. An order with multiple expected products is represented by separate purchase records.
- One receipt can contain one or more actual product lines. Each line identifies a catalog product and the quantity received.
- A received product may differ from the expected product. The received quantity is credited to the actual product in the line.
- Receipt records can be edited or deleted. Deleting or editing an operation removes its former effect and recalculates all dependent figures from the remaining operations.
- The total quantity received is allowed to be lower or higher than the ordered quantity.
- The purchase's total amount paid is allocated evenly across the total quantity actually received for that purchase. It is not divided by the ordered quantity and the user does not enter another price during receipt.

## Data model

### Purchase

The existing purchase remains a single expected product with an ordered quantity, purchase date, and total amount paid. Its amount paid continues to reduce the cash balance once, when the purchase is recorded.

### Receipt

A receipt is an editable event linked to one purchase. It has a date and an optional comment. It contains one or more receipt lines.

Each receipt line stores an actual catalog `productId` and a positive quantity. Multiple lines can reference different products. The UI should preselect the expected product for the first line when starting a receipt, while allowing the user to change it and add more lines.

Receipt unit cost is derived, not stored as an independent price:

`purchase unit cost = purchase amount paid / total quantity in all effective receipt lines for that purchase`

The derived unit cost applies to every actual product line under that purchase. For a historical accounting cutoff, only receipt lines effective by that cutoff contribute to the quantity. If there are no effective receipt lines, the purchase contributes no received inventory value or inventory quantity.

Examples for a purchase paid at 100 ₽:

| Ordered | Actually received | Derived cost | Result |
|---:|---:|---:|---|
| 10 blue pens | 5 blue pens | 20 ₽ per unit | Five blue pens enter inventory at 20 ₽ each |
| 10 blue pens | 20 blue pens | 5 ₽ per unit | Twenty received units enter inventory at 5 ₽ each |
| 10 blue pens | 5 red + 5 blue pens | 10 ₽ per unit | Five units of each actual product enter inventory at 10 ₽ each |

When a receipt quantity or its lines change, the quantity denominator and derived unit cost for all receipts linked to that purchase are recalculated. This can change the weighted average purchase cost and profit for products affected by those receipt lines; this is intentional and follows the rule that totals are derived from current operations.

## User workflow

1. Create a purchase as today: select the expected product and enter ordered quantity and total paid.
2. Create a receipt for that purchase. Enter its date and optional comment, then add actual product/quantity lines. The first line defaults to the expected product.
3. Review a receipt history that identifies the purchase and shows each receipt's date, actual article quantities, and comment.
4. Edit a receipt to correct its date, comment, product lines, or quantities. Delete a receipt to remove its effect entirely.

The purchase list continues to show ordered, actually received, and outstanding quantities. Outstanding quantity is `max(0, ordered quantity - total received quantity)`; received quantity remains visible even when it exceeds ordered quantity.

## Accounting and inventory behavior

- The purchase cash outflow is recorded once from the purchase's total amount paid. A receipt creates no second cash movement.
- Only actual receipt lines add units to the seller's stock, using their actual catalog product IDs and receipt dates.
- Received purchase value is distributed across actual products using the derived unit cost. Existing shared expense allocation continues to use received purchase value.
- Editing or deleting a receipt recomputes purchase received quantities, outstanding quantities, stock, average purchase cost, landed cost, balance, and profit from operations.
- No stored dashboard total or cached balance may be used as the source of truth.
- If deleting a receipt causes later stock movements to make stock negative, preserve and show the resulting negative stock as a reconciliation issue; do not invent a compensating receipt.

## Validation and error handling

- A receipt must reference an existing purchase and at least one existing catalog product line.
- Each line quantity must be positive and use the application's supported quantity precision.
- Do not cap receipt quantity at the purchase's ordered quantity.
- Create, edit, and delete receipt headers and lines transactionally so a partial save cannot leave orphaned or half-updated data.
- Show a clear error if a receipt or its linked purchase/product no longer exists.

## Migration and compatibility

- Preserve every existing receipt's ID, purchase, date, quantity, comment, and creation time.
- Backfill each existing receipt as one receipt line using the purchase's current product ID and the existing received quantity.
- Stop treating the existing persisted receipt `unitCost` as authoritative. Derive unit cost from total paid divided by total received quantity using the new rule.
- Preserve source keys or other uniqueness safeguards during migration.
- Existing purchases and receipt history must remain available after migration.

## Acceptance criteria

1. A receipt can contain multiple actual product lines linked to one purchase.
2. Receiving substitute products credits only those products to seller stock; the expected product is not credited unless it appears in a receipt line.
3. A receipt can be edited and deleted from a visible receipt history.
4. A purchase paid at 100 ₽ yields 20 ₽ per unit for 5 received units, 5 ₽ for 20 received units, and 10 ₽ for 5 red plus 5 blue units.
5. Changing the total received quantity updates derived unit costs for every receipt under that purchase and all dependent accounting totals.
6. Purchase amount paid affects the cash balance once, independently of receipt edits.
7. Migration preserves existing receipt quantities and links them to the purchase's product.
8. Derived balances and stock do not rely on persisted totals and remain correct after a receipt is deleted.

## Scope exclusions

- Combining multiple expected products into one purchase record.
- Supplier management, invoice attachment, or new payment tracking.
- Entering a separate unit price for receipt lines.
- Automatic supplier matching or receipt import.
