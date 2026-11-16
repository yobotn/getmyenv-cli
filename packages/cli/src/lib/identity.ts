import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateMachineIdentity,
  signAccessRequest,
  type MachineKeypair,
} from "@getmyenv/crypto";
import { machineProofMessage, type MachineProof } from "@getmyenv/shared";
import { getConfigDir } from "./fs.js";
import { restrictToOwner } from "./private-file.js";

/**
 * Machine identity per project, stored in the OS user config (never the repo).
 * It identifies this machine for read-only contexts. It does not decrypt values.
 */
export function loadOrCreateIdentity(projectId: string): MachineKeypair {
  const dir = path.join(getConfigDir(), "machines");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${projectId}.json`);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<MachineKeypair>;
      if (typeof data.publicKey === "string" && typeof data.privateKey === "string") {
        return { publicKey: data.publicKey, privateKey: data.privateKey };
      }
    } catch {
      /* regenerate below */
    }
  }
  const identity = generateMachineIdentity();
  fs.writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 });
  // A rewritten broken file keeps its old mode otherwise.
  restrictToOwner(file);
  return identity;
}

export function machineLabel(): string {
  const fromEnv = process.env.GETMYENV_MACHINE_LABEL?.trim();
  if (fromEnv) return fromEnv.slice(0, 120);
  const user = process.env.USERNAME ?? process.env.USER ?? "user";
  return `${user}@${os.hostname()}`.slice(0, 120);
}

export function signMachineProof(
  projectId: string,
  contextSlug: string
): MachineProof {
  const identity = loadOrCreateIdentity(projectId);
  const timestamp = String(Date.now());
  const message = machineProofMessage(
    projectId,
    contextSlug,
    identity.publicKey,
    timestamp
  );
  return {
    publicKey: identity.publicKey,
    label: machineLabel(),
    signature: signAccessRequest(identity.privateKey, message),
    timestamp,
  };
}
