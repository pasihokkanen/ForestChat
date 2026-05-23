// src/lib/chat/tool-executor.ts

import type { ToolDefinition } from "./tools";
import { generatePlan } from "../ai/generate-plan";
import { getStand, searchStands, planSummary, yearOperations } from "../ai/query-tools";
import { addOperation, removeOperation } from "../ai/edit-tools";
import { checkSustainability, validatePlan } from "../ai/validation-tools";

export interface ToolResult {
  success: boolean;
  result: string;
  error?: string;
}

type ToolHandler = (
  args: Record<string, unknown>,
  context: { forestId: string; userId: string }
) => Promise<ToolResult>;

const toolHandlers: Record<string, ToolHandler> = {
  generate_plan: async (args, ctx) => {
    return generatePlan(ctx.forestId, ctx.userId, {
      periodYears: (args.period_years as number) ?? 20,
      startYear: (args.start_year as number) ?? new Date().getFullYear(),
    });
  },
  get_stand: async (args, ctx) => getStand(ctx.forestId, args.stand_id as string),
  search_stands: async (args, ctx) => searchStands(ctx.forestId, args),
  plan_summary: async (_args, ctx) => planSummary(ctx.forestId),
  year_operations: async (args, ctx) => yearOperations(ctx.forestId, args.year as number),
  add_operation: async (args, ctx) => addOperation(ctx.forestId, ctx.userId, args),
  remove_operation: async (args, ctx) => removeOperation(ctx.forestId, args.stand_id as string, args.year as number),
  check_harvest_sustainability: async (args, ctx) => checkSustainability(ctx.forestId, args.year as number | undefined),
  validate_plan: async (_args, ctx) => validatePlan(ctx.forestId),
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: { forestId: string; userId: string }
): Promise<ToolResult> {
  const handler = toolHandlers[name];
  if (!handler) {
    return { success: false, result: "", error: `Unknown tool: ${name}` };
  }
  return handler(args, context);
}

/**
 * Re-export getTools from tools.ts so the API route has a single import point.
 */
export { getTools } from "./tools";
