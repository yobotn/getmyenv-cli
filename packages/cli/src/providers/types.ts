import type { PushProvider } from "@getmyenv/shared";

export type PushProviderId = PushProvider;

/** How the platform stores a value. Readable: anyone with project access sees it. Sensitive: write-only. */
export type VarType = "readable" | "sensitive";

export type Destination = {
  provider: PushProviderId;
  /** "Vercel" or "Netlify". */
  title: string;
  externalId: string;
  /** Vercel project name or Netlify site name. Used in links. */
  externalName: string;
  /** Vercel team or user slug, Netlify account slug. */
  ownerSlug: string;
  /** What we print: "acme/web". */
  label: string;
  target: string;
};

export type PlannedVar = {
  name: string;
  value: string;
  type: VarType;
  change: "add" | "update";
};

export type Skipped = { name: string; reason: string };

export type ApplyResult = {
  written: Array<{ name: string; type: VarType }>;
  pruned: string[];
  notPruned: Skipped[];
  notWritten: Skipped[];
  notes: string[];
};

export interface PushAdapter {
  readonly id: PushProviderId;
  readonly title: string;
  readonly target: string;
  /** Names the platform sets itself or refuses. Never written, never pruned. */
  isReserved(name: string): boolean;
  typeFor(name: string): VarType;
  /** Local checks before any write. */
  check(values: Record<string, string>): { skip: Skipped[]; warnings: string[] };
  /** Extra lines printed with the plan. */
  planNotes(plan: PlannedVar[]): string[];
  destination(): Promise<Destination>;
  /** Names that have a value for this target, without system or reserved names. */
  remoteNames(): Promise<string[]>;
  apply(upserts: PlannedVar[], prune: string[]): Promise<ApplyResult>;
}
