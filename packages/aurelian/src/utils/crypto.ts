import { utf8Encoder } from "./utf8";

/**
 * Supported SHA (Secure Hash Algorithm) variants.
 *
 * - `SHA-1` - 160-bit hash (deprecated for security, use only for legacy compatibility)
 * - `SHA-256` - 256-bit hash (recommended for most use cases)
 * - `SHA-384` - 384-bit hash (part of SHA-2 family)
 * - `SHA-512` - 512-bit hash (maximum security in SHA-2 family)
 */
type ShaAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

export async function sha(
  algorithm: ShaAlgorithm,
  input: string | Uint8Array,
): Promise<string> {
  const encodedInput =
    input instanceof Uint8Array ? input : utf8Encoder.encode(input);
  const data = new Uint8Array(encodedInput);
  const buffer = await crypto.subtle.digest(algorithm, data);
  const bytes = new Uint8Array(buffer);

  let hexString = "";
  for (let i = 0; i < bytes.length; i++) {
    hexString += bytes[i]?.toString(16).padStart(2, "0");
  }

  return hexString;
}
