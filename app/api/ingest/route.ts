import { NextResponse } from "next/server";
import { ingest } from "@/lib/clean";
import type { RawItem, SourceType } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { raw?: RawItem[]; sourceType?: SourceType };
    const raw = Array.isArray(body.raw) ? body.raw : [];
    const sourceType: SourceType = body.sourceType ?? "manual";
    const result = ingest(raw, sourceType);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: `数据处理失败：${e instanceof Error ? e.message : "未知错误"}` },
      { status: 400 }
    );
  }
}
