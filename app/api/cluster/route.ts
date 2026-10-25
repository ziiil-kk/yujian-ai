import { NextResponse } from "next/server";
import { buildClusters } from "@/lib/analysis";
import type { AnalysisResult, OpinionItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      items?: OpinionItem[];
      results?: Record<string, AnalysisResult>;
    };
    const items = Array.isArray(body.items) ? body.items : [];
    const map = new Map(Object.entries(body.results ?? {}));
    const analyzed = items.filter((i) => map.has(i.id));
    const { clusters, note } = await buildClusters(analyzed, map);
    return NextResponse.json({ clusters, note });
  } catch (e) {
    return NextResponse.json(
      { error: `聚类失败：${e instanceof Error ? e.message : "未知错误"}`, clusters: [] },
      { status: 500 }
    );
  }
}
