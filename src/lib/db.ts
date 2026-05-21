import Dexie, { type EntityTable } from "dexie";

// ── Types ──────────────────────────────────────────

export interface Compartment {
  id: string;
  forestId: string;
  standId: string;
  areaHa: number;
  mainSpecies: string | null;
  developmentClass: string | null;
  siteType: string | null;
  age: number | null;
  volumeM3: number | null;
  geometry: GeoJSON.Geometry | null; // stored as JSON
  attributes: Record<string, unknown> | null;
}

export interface Operation {
  id: string;
  compartmentId: string;
  forestId: string;
  type: string;
  year: number;
  removalPct: number;
  incomeEur: number | null;
  costEur: number | null;
}

export interface PlanMetadata {
  id: string;
  forestId: string;
  name: string;
  periodStart: number;
  periodEnd: number;
  totalVolumeM3: number | null;
  stumpageValueEur: number | null;
  annualGrowthM3: number | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls: unknown | null;
  createdAt: Date;
}

// ── Database ───────────────────────────────────────

class ForestChatDB extends Dexie {
  compartments!: EntityTable<Compartment, "id">;
  operations!: EntityTable<Operation, "id">;
  planMetadata!: EntityTable<PlanMetadata, "id">;
  chatMessages!: EntityTable<ChatMessage, "id">;

  constructor() {
    super("ForestChat");
    this.version(1).stores({
      compartments: "id, forestId, standId",
      operations: "id, compartmentId, forestId, year",
      planMetadata: "id, forestId",
      chatMessages: "id, sessionId, role, createdAt",
    });
  }
}

export const db = new ForestChatDB();

export async function clearAllTables(): Promise<void> {
  await db.compartments.clear();
  await db.operations.clear();
  await db.planMetadata.clear();
  await db.chatMessages.clear();
}
