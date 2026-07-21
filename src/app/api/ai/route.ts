import { MockAiProvider } from "@/ai/mock-provider";
import { createAiProviderFromEnv } from "@/ai/openai-compatible-provider";
import { generateRouteOutput, makeFriendlyFailureOutput } from "@/ai/orchestrator";
import type { RouteKey } from "@/domain/types";
import { ROUTE_KEYS } from "@/domain/types";
import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  routeKey: z.enum(ROUTE_KEYS),
  input: z.record(z.string(), z.unknown()).default({}),
  scenario: z
    .enum(["success", "missing_info", "invalid_structure", "unsafe_output", "provider_failure"])
    .default("success"),
});

export async function POST(request: Request) {
  let routeKey: RouteKey = "experience_to_resume";

  try {
    const body = requestSchema.parse(await request.json());
    routeKey = body.routeKey;
    const provider =
      process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY
        ? createAiProviderFromEnv()
        : new MockAiProvider(body.scenario);
    const output = await generateRouteOutput({
      routeKey,
      input: body.input,
      provider,
    });

    return NextResponse.json(output);
  } catch {
    return NextResponse.json(makeFriendlyFailureOutput(routeKey));
  }
}
