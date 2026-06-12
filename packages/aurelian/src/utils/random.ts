import { base64url } from "jose";

export function generateRandomString(length: number): string {
  const requiredBytes = Math.ceil((length * 3) / 4);
  const buffer = new Uint8Array(requiredBytes);

  crypto.getRandomValues(buffer);

  const encoded = base64url.encode(buffer);
  return encoded.slice(0, length);
}
