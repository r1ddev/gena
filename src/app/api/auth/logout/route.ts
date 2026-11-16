import { clearSessionCookie, destroySession } from "@/security/auth";
import { assertLocalMutation, errorResponse, json } from "../../_lib/http";

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    await destroySession(request);
    const response = json({ ok: true });
    response.headers.append("Set-Cookie", clearSessionCookie(request));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
