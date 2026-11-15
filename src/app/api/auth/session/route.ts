import { NextResponse } from "next/server";
import { getAuthenticatedUser, hasRegisteredUsers } from "@/security/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (user) return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ registered: await hasRegisteredUsers() }, { status: 401, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не удалось проверить вход." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
