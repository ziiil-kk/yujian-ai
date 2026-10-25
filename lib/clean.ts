// 舆见 AI —— 入库前的四道清洗
//
// 顺序很重要：去重 → 过滤噪声 → 时间标准化 → 正文提取
// 其中「去重」是最容易被忽略、但对最终结论影响最大的一步。
// 同一篇稿子被十家媒体转载，不去重会让热门主题和情绪占比全部失真。

import type { CleaningStats, NormalizedItem, OpinionItem, RawItem, SourceType } from "./types";
import { analyzeByRules } from "./rules";

/* ---------------- 1. 正文提取 ---------------- */

export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------- 2. 指纹与去重 ---------------- */

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** 标题指纹：去掉标点与语气助词后取前 24 字，用于识别转载 */
export function titleFingerprint(title: string): string {
  const normalized = title
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .replace(/(独家|快讯|重磅|刚刚|最新|深度|评论|观察|解读)/g, "")
    .slice(0, 24);
  return hash(normalized || title.slice(0, 12));
}

export interface DedupResult {
  kept: NormalizedItem[];
  droppedCount: number;
}

/**
 * 三级去重：链接精确 → 标题指纹 → 内容指纹。
 * 保留先出现（通常是最早或最权威）的那条。
 */
export function dedupe(items: NormalizedItem[]): DedupResult {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const seenBody = new Set<string>();
  const kept: NormalizedItem[] = [];
  let droppedCount = 0;

  for (const it of items) {
    const url = (it.url ?? "").trim();
    if (url && seenUrl.has(url)) { droppedCount += 1; continue; }

    const body = stripHtml(it.content ?? "");
    const fp = titleFingerprint(it.title || body.slice(0, 24));
    if (seenTitle.has(fp)) { droppedCount += 1; continue; }

    const bodyFp = hash(body.replace(/\s+/g, "").slice(0, 120));
    if (seenBody.has(bodyFp)) { droppedCount += 1; continue; }

    if (url) seenUrl.add(url);
    seenTitle.add(fp);
    seenBody.add(bodyFp);
    kept.push(it);
  }

  return { kept, droppedCount };
}

/* ---------------- 3. 噪声过滤 ---------------- */

const NOISE_PATTERNS = [
  /^(广告|推广|抽奖|福利|活动预告|目录|导航|关于我们|订阅)/,
  /(点击领取|限时优惠|扫码关注|关注公众号|商务合作请联系)/,
  /^https?:\/\//,
];

/** 返回噪声原因；为空表示不是噪声 */
export function noiseReason(item: RawItem): string | null {
  const text = stripHtml(`${item.title ?? ""} ${item.content ?? ""}`);
  if (text.length < 10) return "正文过短";
  if (NOISE_PATTERNS.some((re) => re.test(text.trim()))) return "命中广告或导航特征";
  // 纯符号、纯数字、无中文且无英文单词
  if (!/[\u4e00-\u9fa5a-zA-Z]{6,}/.test(text)) return "缺少有效文本内容";
  return null;
}

/* ---------------- 4. 时间标准化 ---------------- */

const CN_NUM: Record<string, string> = {
  一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10",
};

export interface ParsedTime {
  iso: string;
  known: boolean;
}

/**
 * 多格式时间解析。解析失败时用采集时间兜底，但把 known 置为 false，
 * 让下游知道「这个时间不是源给的」，避免污染趋势统计。
 */
export function parseTime(raw: string | undefined, fallback: Date): ParsedTime {
  if (!raw || !raw.trim()) return { iso: fallback.toISOString(), known: false };
  const s = raw.trim();

  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime())) {
    return { iso: direct.toISOString(), known: true };
  }

  // 2026年9月22日 09:14 / 9月22日 09:14
  const cn = s.match(/(\d{4})?年?\s*(\d{1,2})月\s*(\d{1,2})日\s*(\d{1,2})?[:：]?(\d{2})?/);
  if (cn) {
    const year = cn[1] ? Number(cn[1]) : fallback.getFullYear();
    const month = cn[2].replace(/[一二三四五六七八九十]/g, (m) => CN_NUM[m] ?? m);
    const day = cn[3].replace(/[一二三四五六七八九十]/g, (m) => CN_NUM[m] ?? m);
    const d = new Date(year, Number(month) - 1, Number(day), Number(cn[4] ?? 9), Number(cn[5] ?? 0));
    if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), known: true };
  }

  // 2026-09-22 09:14 / 2026/09/22
  const dash = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (dash) {
    const d = new Date(
      Number(dash[1]), Number(dash[2]) - 1, Number(dash[3]),
      Number(dash[4] ?? 9), Number(dash[5] ?? 0)
    );
    if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), known: true };
  }

  return { iso: fallback.toISOString(), known: false };
}

/* ---------------- 统一入口 ---------------- */

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export interface IngestResult {
  items: OpinionItem[];
  stats: CleaningStats;
  dropped: { reason: string; title: string }[];
}

/**
 * 把任意来源的原始条目变成统一的数据池条目。
 * 无论数据来自订阅、粘贴还是 CSV，都走这一条路径 —— 这是「数据层统一抽象」的落点。
 */
export function ingest(
  raw: RawItem[],
  sourceType: SourceType,
  defaultSource = "未知"
): IngestResult {
  const now = new Date();
  const fetched = raw.length;

  const cleaned: NormalizedItem[] = [];
  const dropped: { reason: string; title: string }[] = [];

  for (const it of raw) {
    const normalized: NormalizedItem = {
      ...it,
      title: (it.title ?? "").trim() || stripHtml(it.content ?? "").slice(0, 40),
      content: stripHtml(it.content ?? ""),
      source: (it.source ?? "").trim() || defaultSource,
    };
    const reason = noiseReason(normalized);
    if (reason) {
      dropped.push({ reason, title: normalized.title });
      continue;
    }
    cleaned.push(normalized);
  }

  const { kept, droppedCount } = dedupe(cleaned);

  const items: OpinionItem[] = kept.map((it) => {
    const t = parseTime(it.publishedAt, now);
    return {
      id: nextId("itm"),
      title: it.title,
      content: it.content ?? "",
      source: it.source,
      sourceType,
      url: it.url,
      publishedAt: t.iso,
      collectedAt: now.toISOString(),
      timeKnown: t.known,
      dedupHash: titleFingerprint(it.title),
      status: "pending" as const,
    };
  });

  return {
    items,
    stats: {
      fetched,
      duplicated: droppedCount,
      noisy: dropped.length,
      kept: items.length,
    },
    dropped,
  };
}

/** 解析 CSV 文本（表头：published_at, source, content, title, url） */
export function parseCsv(text: string): RawItem[] {
  const rows = splitCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    publishedAt: header.findIndex((h) => ["published_at", "time", "时间", "发布时间"].includes(h)),
    source: header.findIndex((h) => ["source", "来源"].includes(h)),
    content: header.findIndex((h) => ["content", "text", "正文", "内容"].includes(h)),
    title: header.findIndex((h) => ["title", "标题"].includes(h)),
    url: header.findIndex((h) => ["url", "link", "链接"].includes(h)),
  };
  const hasHeader = idx.content >= 0;
  const body = hasHeader ? rows.slice(1) : rows;

  return body
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => ({
      publishedAt: idx.publishedAt >= 0 ? r[idx.publishedAt] : undefined,
      source: idx.source >= 0 ? r[idx.source] : undefined,
      title: idx.title >= 0 ? r[idx.title] : undefined,
      url: idx.url >= 0 ? r[idx.url] : undefined,
      content: (hasHeader ? r[idx.content] : r.join(" ")) ?? "",
    }))
    .filter((it) => it.content);
}

/** 支持引号包裹的 CSV 拆分 */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (c === "\r") continue;
    cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** 把逐行粘贴的文本转成条目：一行一条 */
export function parsePasted(text: string): RawItem[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // 支持 "来源|时间|正文" 的行内格式，更贴近真实复制场景
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length >= 3) {
        return { source: parts[0], publishedAt: parts[1], content: parts.slice(2).join(" ") };
      }
      return { content: line };
    });
}

/** 供演示使用：把任意文本视为一条或多条 */
export function toAnalyzedPreview(items: OpinionItem[]) {
  return items.map((it) => ({ item: it, preview: analyzeByRules(it.content, it.title) }));
}
