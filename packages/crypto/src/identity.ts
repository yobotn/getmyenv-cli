import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToBase64, base64ToBytes, getRandomBytes, utf8Encode } from "./bytes.js";

/**
 * Machine identity keypair.
 * Identifies a machine for access requests. It does not decrypt values.
 */
export type MachineKeypair = {
  publicKey: string; // base64
  privateKey: string; // base64
};

export function generateMachineIdentity(): MachineKeypair {
  const privateKey = getRandomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    publicKey: bytesToBase64(publicKey),
    privateKey: bytesToBase64(privateKey),
  };
}

export function signAccessRequest(
  privateKeyB64: string,
  message: string
): string {
  const privateKey = base64ToBytes(privateKeyB64);
  const sig = ed25519.sign(utf8Encode(message), privateKey);
  return bytesToBase64(sig);
}

export function verifyAccessRequest(
  publicKeyB64: string,
  message: string,
  signatureB64: string
): boolean {
  try {
    return ed25519.verify(
      base64ToBytes(signatureB64),
      utf8Encode(message),
      base64ToBytes(publicKeyB64)
    );
  } catch {
    return false;
  }
}
