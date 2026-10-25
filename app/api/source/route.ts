import { NextResponse } from "next/server";
import { fetchFeed, keywordFeedUrl, PRESET_SOURCES } from "@/lib/rss";
import { ingest } from "@/lib/clean";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  action: "list" | "preview" | "fetch";
  sourceId?: string;
  keyword?: string;
  limit?: number;
}

/**
 * 服务端代理：浏览器直接请求外部订阅源会被跨域策略拦截，
 * 所以统一由服务端代取。这也是选择 Next.js 的直接原因。
 */
export async function POST(req: Request) {
  const body = (await req.json()) as Body;

  if (body.action === "list") {
    return NextResponse.json({ sources: PRESET_SOURCES });
  }

  const keyword = (body.keyword ?? "AI").trim() || "AI";
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);
  const preset = PRESET_SOURCES.find((s) => s.id === body.sourceId);

  if (!preset) {
    return NextResponse.json({ error: "未知的数据源。" }, { status: 400 });
  }

  const url =
    preset.type === "keyword_feed"
      ? keywordFeedUrl(keyword, preset.channel ?? "bing")
      : preset.url!;

  const result = await fetchFeed(url, preset.name);

  if (!result.ok) {
    // 单个源失败不抛出异常，交给前端做降级提示
    return NextResponse.json({
      ok: false,
      sourceName: preset.name,
      url,
      error: result.error,
      items: [],
      stats: { fetched: 0, duplicated: 0, noisy: 0, kept: 0 },
    });
  }

  const sliced = result.items.slice(0, limit);

  // 预览模式：只回传 5 条样本，不写入数据池
  if (body.action === "preview") {
    return NextResponse.json({
      ok: true,
      sourceName: preset.name,
      url,
      preview: sliced.slice(0, 5).map((i) => ({
        title: i.title ?? (i.content ?? "").slice(0, 40),
        source: i.source,
        publishedAt: i.publishedAt ?? "",
      })),
      total: sliced.length,
      stats: { fetched: sliced.length, duplicated: 0, noisy: 0, kept: sliced.length },
      items: [],
    });
  }

  const ingested = ingest(sliced, preset.type === "keyword_feed" ? "keyword_feed" : "rss", preset.name);
  return NextResponse.json({
    ok: true,
    sourceName: preset.name,
    url,
    items: ingested.items,
    dropped: ingested.dropped.slice(0, 10),
    stats: ingested.stats,
  });
}
