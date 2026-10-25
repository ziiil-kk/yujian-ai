import { NextResponse } from "next/server";
import { analyzeBatch, analyzeItem, ENGINE_LIVE } from "@/lib/analysis";
import { getLLMConfig } from "@/lib/llm";
import type { OpinionItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { items?: OpinionItem[] };
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ error: "没有待分析的条目。" }, { status: 400 });
    }

    const cfg = getLLMConfig();

    // 单条请求用于「重新分析这一条」
    if (items.length === 1) {
      const r = await analyzeItem(items[0]);
      return NextResponse.json({
        results: [[items[0].id, r]],
        failed: [],
        engine: cfg.live ? ENGINE_LIVE : "规则引擎 (mock)",
      });
    }

    const outcome = await analyzeBatch(items, cfg.live ? 3 : 8);
    return NextResponse.json({
      results: [...outcome.results.entries()],
      failed: outcome.failed.map((f) => f.id),
      engine: cfg.live ? ENGINE_LIVE : "规则引擎 (mock)",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `分析失败：${e instanceof Error ? e.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
