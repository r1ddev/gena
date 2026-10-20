# Product analysis and MVP plan

**Status:** implementation baseline for the first local MVP. The application and its main flows are implemented. The Ozon connection and migration still need verification against the owner’s live account and current data export.

## 1. Product goal

Gena is a local, open-source accounting service for one Ozon FBO seller and one Ozon account. It replaces manual operational tracking with a catalog, stock movements, purchases, expenses, sales, returns, writeoffs, reconciliation, and transparent money and profit calculations.

The service is the source of truth for the catalog, purchases and receipts, manual supplies, expenses, seller writeoffs, and inventory resolutions. Ozon supplies marketplace orders, statuses, returns, and financial records through its API. The service does not create or edit marketplace cards, prices, orders, or supplies.

## 2. Product scope

| Area | MVP behavior |
| --- | --- |
| Catalog | Universal product categories and internal SKUs; links to Ozon identifiers; archive without losing history |
| Purchases | Ordered quantity and money recorded immediately; partial receipts add only received quantity to stock and average purchase cost |
| Stock | Separate seller and Ozon balances derived from dated operations |
| Supplies | Created manually; immediately transfer stock to Ozon; delivery cost affects cash and the shared expense coefficient once |
| Orders | Ozon FBO statuses are synchronized; delivery moves stock out of Ozon; unknown product IDs wait for a saved mapping decision |
| Returns | Seller stock changes after actual receipt; Ozon stock changes after the item becomes available for sale |
| Financial records | Order-level marketplace charges, marketplace buyouts, and compensation accruals are imported; compensation is split from other accruals and counted once |
| Expenses and writeoffs | General expenses, Ozon writeoffs, and seller losses are separate operation types |
| Inventory | Counted quantities are recorded separately; each discrepancy is resolved individually |
| Import | `.xlsx` and `.csv` files receive a transactional dry-run preview with row-level issues before the owner confirms applying them |
| Scenario calculator | Nominal profit is isolated from actual balances and profit |
| Local operations | Docker Compose, local PostgreSQL data, daily backups, and restore workflow |

## 3. Accounting rules

- Current stock, average purchase cost, landed cost, cash balance, and profit are calculated from source operations when requested. Removing a source row from PostgreSQL must change the next result.
- Only received purchase quantity enters inventory and average purchase cost. The entered purchase payment affects cash immediately, including for goods that have not arrived.
- Ordinary delivered orders are preliminary for 21 days from the first synchronization that observes the Ozon “Delivered” status, which represents handoff to the buyer. Before that deadline, their amount and expected profit appear separately. They enter the main calculation after the deadline, and later Ozon returns or adjustments update the result.
- A historical sales row with a generic or ambiguous date is left out of the import until its event date can be established; the importer does not guess that it is the buyer handoff date.
- Marketplace buyouts are a separate transaction type and are recognized from Ozon’s financial buyout report, without waiting 21 days.
- Ozon delivery reduces Ozon stock. A return to the seller increases seller stock only when physically received. A return to Ozon increases its stock when Ozon makes the item sellable again.
- Ozon writeoff reduces Ozon stock. Compensation enters cash and profit through recognized Ozon finance accruals; the report amount remains a cross-check and is never added a second time.
- General expenses and supply delivery costs are distributed through the agreed shared cost coefficient. Ozon order-level charges stay attached to their financial records. Every source amount affects a balance once.
- Inventory discrepancies are never silently written off; each is explicitly resolved. There can be at most one inventory count per warehouse per day. Negative stock remains visible as a reconciliation error.
- The nominal profit calculator never changes actual operations or totals.

The calculation inputs and deletion/recalculation cases are documented in [accounting-data-model-and-recalculation.md](accounting-data-model-and-recalculation.md).

## 4. Technical implementation

- **Application:** TypeScript, React, and Next.js. Next.js serves both the interface and server routes; the browser never connects directly to PostgreSQL.
- **Database access:** Drizzle ORM with versioned SQL migrations; PostgreSQL stores primary operations and raw Ozon/import records.
- **Background work:** a separate worker container performs manual and daily Ozon synchronization and creates backups.
- **Local runtime:** Docker Compose starts PostgreSQL, a migration job, the web application, and the worker. The web port is bound to the local loopback interface; PostgreSQL is not published to the host network.
- **Secrets and backups:** the Ozon API key is encrypted in PostgreSQL. Daily local backups retain the database, encryption key, and connection settings; 30 daily backup folders are kept.
- **Import:** `.xlsx` and `.csv` parsing produces a transactional dry-run with the same row validation as apply. Row identities use type and normalized row content so unchanged operations remain idempotent across renamed and reordered files. A changed row at the same sheet position as an applied import is blocked for review before it can affect totals.
- **Derived values:** totals are not stored as independent balance or stock fields. They are recalculated from current source records.

## 5. Implementation status and remaining verification

### Implemented

- Local container setup and PostgreSQL migrations.
- Catalog, purchases and partial receipts, manual supplies, expenses, seller writeoffs, and inventory reconciliation.
- Derived stock, cost, cash and profit views, plus separate preliminary sales and nominal profit.
- Import preview and apply for `.xlsx` and `.csv` files.
- Ozon FBO posting, return, daily finance, buyout report, and decommission report adapters; manual and scheduled sync entry points.
- Encrypted settings, local daily backups, and a database replacement restore workflow.

### Still required before calling the service verified for daily use

1. Reconcile the completed dry-run against the current export: resolve missing event dates, unknown product IDs, and possible duplicate matches before applying any history.
2. Enter the owner’s Ozon credentials and verify the actual API responses, permissions, rate limits, and initial history range. No authorized live Ozon request has been made.
3. Verify compensation accrual type IDs and one-to-one examples against the owner's actual Ozon cabinet; do not add the writeoff report amount separately.
4. Verify the Ozon signal that means a returned item is again available for sale on its warehouse.
5. Compare the imported history and live Ozon data with the resulting balances and show all unresolved rows and differences.

The current API method map and contract notes are in [data-import-and-ozon-api-audit.md](data-import-and-ozon-api-audit.md). These checks require account data; they are not substitutes for the implemented local application.
