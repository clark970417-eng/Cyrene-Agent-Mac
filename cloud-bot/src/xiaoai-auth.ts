import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** 檢查 `Authorization: Bearer <token>` 是否等於設定的共用密鑰。長度不同直接視為不通過。 */
export function isAuthorizedDevice(request: IncomingMessage, expectedToken: string | undefined): boolean {
  if (!expectedToken) return false;
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length).trim());
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
