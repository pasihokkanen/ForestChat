// src/lib/chat/tool-executor.ts

import type { SupabaseClient } from "@supabase/supabase-js";
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

export interface ToolContext {
  forestId: string;
  userId: string;
  supabase: SupabaseClient;
}

type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

const toolHandlers: Record<string, ToolHandler> = {
  generate_plan: async (args, ctx) => {
    return generatePlan(ctx.supabase, ctx.forestId, ctx.userId, {
      periodYears: (args.period_years as number) ?? 20,
      startYear: (args.start_year as number) ?? new Date().getFullYear(),
    });
  },
  get_stand: async (args, ctx) => getStand(ctx.supabase, ctx.forestId, args.stand_id as string),
  search_stands: async (args, ctx) => searchStands(ctx.supabase, ctx.forestId, args),
  plan_summary: async (_args, ctx) => planSummary(ctx.supabase, ctx.forestId),
  year_operations: async (args, ctx) => yearOperations(ctx.supabase, ctx.forestId, args.year as number),
  add_operation: async (args, ctx) => addOperation(ctx.supabase, ctx.forestId, ctx.userId, args),
  remove_operation: async (args, ctx) => removeOperation(ctx.supabase, ctx.forestId, args.stand_id as string, args.year as number),
  check_harvest_sustainability: async (args, ctx) => checkSustainability(ctx.supabase, ctx.forestId, args.year as number | undefined),
  validate_plan: async (_args, ctx) => validatePlan(ctx.supabase, ctx.forestId),
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const handler = toolHandlers[name];
  if (!handler) {
    return { success: false, result: "", error: `Unknown tool: ${name}` };
  }
  return handler(args, context);
}

export { getTools } from "./tools";