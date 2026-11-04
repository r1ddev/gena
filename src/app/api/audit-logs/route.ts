import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { handleLocalGet } from "../_lib/http";

const pageSize = 50;

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
    const query = (params.get("q") ?? "").trim().slice(0, 160);
    const source = (params.get("source") ?? "").trim().slice(0, 80);
    const entity = (params.get("entity") ?? "").trim().slice(0, 80);
    const filters = [];

    if (source) filters.push(eq(auditEvents.source, source));
    if (entity) filters.push(eq(auditEvents.entityType, entity));
    if (query) {
      const pattern = `%${query}%`;
      filters.push(or(
        ilike(auditEvents.recordKey, pattern),
        ilike(auditEvents.entityType, pattern),
        ilike(auditEvents.action, pattern),
        sql`${auditEvents.changedFields}::text ILIKE ${pattern}`,
      )!);
    }

    const where = filters.length ? and(...filters) : undefined;
    const [items, [totalRow], [sources]] = await Promise.all([
      db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id)).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ value: count() }).from(auditEvents).where(where),
      db.select({ values: sql<string[]>`array_agg(DISTINCT ${auditEvents.source} ORDER BY ${auditEvents.source})` }).from(auditEvents),
    ]);

    return {
      items,
      sources: sources.values ?? [],
      page,
      pageSize,
      total: totalRow.value,
      totalPages: Math.ceil(totalRow.value / pageSize),
    };
  });
}
