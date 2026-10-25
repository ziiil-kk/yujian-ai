import { NextResponse } from "next/server";
import { assessRisk } from "@/lib/analysis";
import { computeStats } from "@/lib/stats";
import type { AnalysisResult, Cluster, Correction, OpinionItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      items?: OpinionItem[];
      results?: Record<string, AnalysisResult>;
      clusters?: Cluster[];
      corrections?: Correction[];
    };
    const items = Array.isArray(body.items) ? body.items : [];
    const map = new Map(Object.entries(body.results ?? {}));
    const analyzed = items.filter((i) => map.has(i.id));
    const corrections = body.corrections ?? [];
    const stats = computeStats(analyzed, map, new Set(corrections.map((c) => c.itemId)));
    const { assessment, weightedScore } = await assessRisk(
      analyzed,
      map,
      body.clusters ?? [],
      stats,
      corrections
    );
    return NextResponse.json({ assessment, weightedScore });
  } catch (e) {
    return NextResponse.json(
      { error: `风险研判失败：${e instanceof Error ? e.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
