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
| Financial records | Order-level marketplace charges, marketplace buyouts, and writeoff compensation are imported and shown by source |
| Expenses and writeoffs | General expenses, Ozon writeoffs, and seller losses are separate operation types |
| Inventory | Counted quantities are recorded separately; each discrepancy is resolved individually |
| Import | `.xlsx` and `.csv` files can be previewed and applied with a row-level issues report |
| Scenario calculator | Nominal profit is isolated from actual balances and profit |
| Local operations | Docker Compose, local PostgreSQL data, daily backups, and restore workflow |

## 3. Accounting rules

- Current stock, average purchase cost, landed cost, cash balance, and profit are calculated from source operations when requested. Removing a source row from PostgreSQL must change the next result.
- Only received purchase quantity enters inventory and average purchase cost. The entered purchase payment affects cash immediately, including for goods that have not arrived.
- Ordinary delivered orders are preliminary for 21 days from the delivery event. Before that deadline, their amount and expected profit appear separately. They enter the main calculation after the deadline, and later Ozon returns or adjustments update the result.
- The Ozon status “Delivered” means the goods were handed to the buyer. When Ozon does not provide a delivery timestamp, the service records when it first observes this status during synchronization.
- Marketplace buyouts are a separate transaction type and are recognized from Ozon’s financial buyout report, without waiting 21 days.
- Ozon delivery reduces Ozon stock. A return to the seller increases seller stock only when physically received. A return to Ozon increases its stock when Ozon makes the item sellable again.
- Ozon writeoff reduces Ozon stock and records any confirmed compensation as marketplace revenue, once. Seller loss reduces seller stock and profit by the item’s landed cost, without a second cash deduction.
- General expenses and supply delivery costs are distributed through the agreed shared cost coefficient. Ozon order-level charges stay attached to their financial records. Every source amount affects a balance once.
- Inventory discrepancies are never silently written off; each is explicitly resolved. Negative stock remains visible as a reconciliation error.
- The nominal profit calculator never changes actual operations or totals.

The calculation inputs and deletion/recalculation cases are documented in [accounting-data-model-and-recalculation.md](accounting-data-model-and-recalculation.md).

## 4. Technical implementation

- **Application:** TypeScript, React, and Next.js. Next.js serves both the interface and server routes; the browser never connects directly to PostgreSQL.
- **Database access:** Drizzle ORM with versioned SQL migrations; PostgreSQL stores primary operations and raw Ozon/import records.
- **Background work:** a separate worker container performs manual and daily Ozon synchronization and creates backups.
- **Local runtime:** Docker Compose starts PostgreSQL, a migration job, the web application, and the worker. The web port is bound to the local loopback interface; PostgreSQL is not published to the host network.
- **Secrets and backups:** the Ozon API key is encrypted in PostgreSQL. Daily local backups retain the database, encryption key, and connection settings; 30 daily backup folders are kept.
- **Import:** `.xlsx` and `.csv` parsing produces a preview and row issues. Applying an import is transactional and uses file-content based identities to avoid duplicate operations.
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

1. Test import preview and reconciliation against a current export of the owner’s data. The current export has not yet been supplied for this implementation run.
2. Enter the owner’s Ozon credentials and verify the actual API responses, permissions, rate limits, and initial history range. No authorized live Ozon request has been made.
3. Confirm how buyout report amounts, daily finance accruals, and confirmed writeoff compensation reconcile, so the same transaction is neither omitted nor counted twice.
4. Verify the Ozon signal that means a returned item is again available for sale on its warehouse.
5. Compare the imported history and live Ozon data with the resulting balances and show all unresolved rows and differences.

The current API method map and contract notes are in [data-import-and-ozon-api-audit.md](data-import-and-ozon-api-audit.md). These checks require account data; they are not substitutes for the implemented local application.
