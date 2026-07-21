import { MockAiProvider } from "@/ai/mock-provider";
import { createAiProviderFromEnv } from "@/ai/chat-completion-provider";
import { generateLightReviewOutput, generateRouteOutput, makeFriendlyFailureOutput } from "@/ai/orchestrator";
import type { RouteKey } from "@/domain/types";
import { ROUTE_KEYS } from "@/domain/types";
import type { LocalRecord } from "@/lib/local-store";
import { NextResponse } from "next/server";
import { z } from "zod";

const localRecordSchema = z.object({
  id: z.string(),
  routeKey: z.enum(ROUTE_KEYS),
  recordType: z.string(),
  actionTitle: z.string(),
  actualDone: z.string(),
  payload: z.record(z.string(), z.string()).default({}),
  userConfirmed: z.boolean(),
  createdAt: z.string(),
});

const requestSchema = z.object({
  routeKey: z.enum(ROUTE_KEYS),
  input: z.record(z.string(), z.unknown()).default({}),
  mode: z.enum(["route", "light_review"]).default("route"),
  scenario: z
    .enum(["success", "missing_info", "invalid_structure", "unsafe_output", "provider_failure"])
    .default("success"),
});

export async function POST(request: Request) {
  let routeKey: RouteKey = "experience_to_resume";

  try {
    const body = requestSchema.parse(await request.json());
    routeKey = body.routeKey;
    const canUseScenarioMock = process.env.NODE_ENV !== "production" && !process.env.DEEPSEEK_API_KEY;
    const provider =
      process.env.DEEPSEEK_API_KEY
        ? createAiProviderFromEnv()
        : new MockAiProvider(canUseScenarioMock ? body.scenario : "provider_failure");
    const output =
      body.mode === "light_review"
        ? await generateLightReviewOutput({
            record: localRecordSchema.parse(body.input.record) as LocalRecord,
            provider,
          })
        : await generateRouteOutput({
            routeKey,
            input: body.input,
            provider,
          });

    return NextResponse.json(output);
  } catch {
    return NextResponse.json(makeFriendlyFailureOutput(routeKey));
  }
}
