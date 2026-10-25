// 舆见 AI —— 订阅源解析
//
// 说明：这里手写了一个容错的 RSS 2.0 / Atom 解析器，而不是引入第三方依赖。
// 原因：订阅源在我们的场景里只用来取「标题 / 正文 / 时间 / 链接」四个字段，
// 结构高度稳定；为了四个字段引入一个完整的 XML 解析库并不划算。
// 容错优先：任何字段缺失都不应该让整批失败。

import type { RawItem } from "./types";
import { stripHtml } from "./clean";

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

/** 取某个标签的内容，支持命名空间前缀，例如 content:encoded */
function tag(block: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
    const m = block.match(re);
    if (m && m[1].trim()) return decodeEntities(unwrapCdata(m[1].trim()));
  }
  return undefined;
}

/** 从 Atom 的 <link href="..."/> 取链接 */
function atomLink(block: string): string | undefined {
  const rel = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (rel) return rel[1];
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any ? any[1] : undefined;
}

export interface ParsedFeed {
  title?: string;
  items: RawItem[];
}

export function parseFeed(xml: string, fallbackSource: string): ParsedFeed {
  const feedTitle = tag(xml.slice(0, 2000), "title");

  const blocks: string[] = [];
  const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) blocks.push(m[2]);

  const items: RawItem[] = [];
  for (const b of blocks) {
    const title = tag(b, "title");
    const rawContent =
      tag(b, "content:encoded") ??
      tag(b, "content") ??
      tag(b, "description") ??
      tag(b, "summary") ??
      "";

    const content = stripHtml(rawContent);
    if (!content && !title) continue;

    const link = tag(b, "link") ?? atomLink(b);
    const date =
      tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");

    items.push({
      title: title ? stripHtml(title) : undefined,
      content: content || stripHtml(title ?? ""),
      source: tag(b, "source") ?? fallbackSource,
      publishedAt: date,
      url: link,
    });
  }

  // 也支持 JSON Feed（部分现代站点使用）
  if (items.length === 0 && xml.trim().startsWith("{")) {
    try {
      const j = JSON.parse(xml) as {
        title?: string;
        items?: { title?: string; content_text?: string; content_html?: string; date_published?: string; url?: string }[];
      };
      for (const it of j.items ?? []) {
        const content = stripHtml(it.content_text ?? it.content_html ?? "");
        if (!content && !it.title) continue;
        items.push({
          title: it.title,
          content: content || stripHtml(it.title ?? ""),
          source: fallbackSource,
          publishedAt: it.date_published,
          url: it.url,
        });
      }
      return { title: j.title ?? feedTitle, items };
    } catch {
      /* 落到下面返回空 */
    }
  }

  return { title: feedTitle, items };
}

export interface FetchFeedResult {
  ok: boolean;
  items: RawItem[];
  sourceName: string;
  error?: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * 拉取一个订阅源。任何失败都以「该源失败」返回，不抛异常——
 * 单个源挂掉不应该让整批采集失败。
 */
export async function fetchFeed(
  url: string,
  name: string,
  timeoutMs = 15000
): Promise<FetchFeedResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, items: [], sourceName: name, error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    const parsed = parseFeed(text, name);
    if (parsed.items.length === 0) {
      return {
        ok: false,
        items: [],
        sourceName: name,
        error: "返回内容不是有效的订阅源（未解析到条目）",
      };
    }
    return {
      ok: true,
      items: parsed.items.map((it) => ({ ...it, source: name })),
      sourceName: name,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      items: [],
      sourceName: name,
      error: msg.includes("abort") ? "请求超时" : `连接失败：${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 关键词订阅源：把关键词拼进查询串 */
export function keywordFeedUrl(keyword: string, channel: "bing" | "google"): string {
  const q = encodeURIComponent(keyword);
  if (channel === "google") {
    return `https://news.google.com/rss/search?q=${q}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  }
  return `https://www.bing.com/news/search?q=${q}&format=RSS&mkt=zh-CN`;
}

/** 预置数据源清单（可在界面上一键添加） */
export const PRESET_SOURCES: {
  id: string;
  name: string;
  type: "keyword_feed" | "rss";
  channel?: "bing" | "google";
  url?: string;
  note: string;
}[] = [
  { id: "kw-bing", name: "AI 关键词订阅", type: "keyword_feed", channel: "bing", note: "免密钥，国内可访问" },
  { id: "kw-google", name: "AI 关键词订阅（Google）", type: "keyword_feed", channel: "google", note: "免密钥，需可访问 Google" },
  { id: "rss-jiqizhixin", name: "机器之心", type: "rss", url: "https://www.jiqizhixin.com/rss", note: "AI 垂直媒体" },
  { id: "rss-qbitai", name: "量子位", type: "rss", url: "https://www.qbitai.com/feed", note: "AI 垂直媒体" },
  { id: "rss-infoq", name: "InfoQ 中文", type: "rss", url: "https://www.infoq.cn/feed", note: "技术媒体" },
  { id: "rss-36kr", name: "36氪", type: "rss", url: "https://36kr.com/feed", note: "科技商业" },
  { id: "rss-huxiu", name: "虎嗅", type: "rss", url: "https://www.huxiu.com/rss/0.xml", note: "科技商业" },
  { id: "rss-jiemian", name: "界面新闻", type: "rss", url: "https://a.jiemian.com/index.php?m=article&a=rss", note: "财经媒体" },
  { id: "rss-tmtpost", name: "钛媒体", type: "rss", url: "https://www.tmtpost.com/rss.xml", note: "科技商业" },
];
