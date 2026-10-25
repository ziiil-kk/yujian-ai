import { NextResponse } from "next/server";
import { buildReport } from "@/lib/analysis";
import type { DatasetStats } from "@/lib/stats";
import type { Cluster, Correction, RiskAssessment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      stats?: DatasetStats;
      clusters?: Cluster[];
      assessment?: RiskAssessment;
      corrections?: Correction[];
      range?: { start: string; end: string };
    };
    if (!body.stats || !body.assessment) {
      return NextResponse.json({ error: "缺少分析结果，请先完成分析。" }, { status: 400 });
    }
    const report = await buildReport(
      body.stats,
      body.clusters ?? [],
      body.assessment,
      body.corrections ?? [],
      body.range ?? { start: "-", end: "-" }
    );
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json(
      { error: `简报生成失败：${e instanceof Error ? e.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
