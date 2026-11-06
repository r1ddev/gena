import { registerAccount } from "@/security/auth";
import { assertLocalMutation, errorResponse, json } from "../../_lib/http";

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body: unknown = await request.json();
    return await registerAccount(request, body, json);
  } catch (error) {
    return errorResponse(error);
  }
}
