import { getSupplyCargoLabelImage } from "@/ozon/supply-label-reconciliation";
import { assertLocalRequest, errorResponse } from "@/app/api/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalRequest(request);
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("Этикетка не найдена.");
    }
    const label = await getSupplyCargoLabelImage(id);
    if (!label) throw new Error("Этикетка ещё не сохранена.");
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(label.image), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(label.image.byteLength),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="cargo-${label.cargoId}.png"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return errorResponse(error); }
}
