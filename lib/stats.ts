// 舆见 AI —— 指标口径
// Dashboard 上的每一个数字都在这里定义，并且只在这里定义。
// 口径不写清楚的图表，等于自欺欺人。

import type { AnalysisResult, OpinionItem, RiskLevel, Sentiment } from "./types";
import { RISK_ORDER } from "./types";

export interface Distribution<T extends string> {
  key: T;
  count: number;
  ratio: number;
}

export interface TrendPoint {
  date: string;
  label: string;
  total: number;
  negative: number;
}

export interface DatasetStats {
  total: number;
  sentiment: Distribution<Sentiment>[];
  risk: Distribution<RiskLevel>[];
  topics: Distribution<string>[];
  keywords: { term: string; count: number }[];
  trend: TrendPoint[];
  sources: { name: string; count: number }[];
  needReview: number;
  corrected: number;
  failed: number;
  timeUnknown: number;
  avgConfidence: number;
  recentNegativeRatio: number;
  growthRate: number;
  trendNote: string;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

export function computeStats(
  items: OpinionItem[],
  results: Map<string, AnalysisResult>,
  correctedIds: Set<string>
): DatasetStats {
  const analyzed = items.filter((it) => results.has(it.id));
  const total = analyzed.length;

  const sentimentCount: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
  const riskCount: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const topicCount = new Map<string, number>();
  const keywordCount = new Map<string, number>();
  const sourceCount = new Map<string, number>();
  const byDay = new Map<string, { total: number; negative: number }>();

  let confSum = 0;
  let needReview = 0;
  let failed = 0;
  let timeUnknown = 0;

  for (const it of items) {
    if (it.status === "failed") failed += 1;
    if (!it.timeKnown) timeUnknown += 1;
  }

  for (const it of analyzed) {
    const r = results.get(it.id)!;
    sentimentCount[r.sentiment] += 1;
    riskCount[r.risk_level] += 1;
    topicCount.set(r.topic, (topicCount.get(r.topic) ?? 0) + 1);
    sourceCount.set(it.source, (sourceCount.get(it.source) ?? 0) + 1);
    confSum += r.sentiment_confidence;
    if (r.need_human_review) needReview += 1;

    for (const k of r.keywords) {
      if (!k || k === "未提取") continue;
      keywordCount.set(k, (keywordCount.get(k) ?? 0) + 1);
    }

    // 时间未知的条目不进趋势，避免污染曲线
    if (it.timeKnown) {
      const key = dayKey(it.publishedAt);
      const cur = byDay.get(key) ?? { total: 0, negative: 0 };
      cur.total += 1;
      if (r.sentiment === "negative") cur.negative += 1;
      byDay.set(key, cur);
    }
  }

  const trend: TrendPoint[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, label: date.slice(5), total: v.total, negative: v.negative }));

  // 近 3 日负面占比 —— 用于判断「情绪是否在恶化」，只看总量会漏掉这个信号
  const recent = trend.slice(-3);
  const recentTotal = recent.reduce((s, p) => s + p.total, 0);
  const recentNegative = recent.reduce((s, p) => s + p.negative, 0);
  const recentNegativeRatio = ratio(recentNegative, recentTotal);

  // 热度增速：末日 vs 早段日均
  const last = trend[trend.length - 1]?.total ?? 0;
  const early = trend.slice(0, 3);
  const earlyAvg = early.length
    ? early.reduce((s, p) => s + p.total, 0) / early.length
    : 0;
  const growthRate = earlyAvg > 0 ? last / earlyAvg - 1 : 0;

  const peak = trend.reduce((m, p) => (p.total > m.total ? p : m), trend[0] ?? { label: "-", total: 0, date: "", negative: 0 });
  const trendNote = trend.length
    ? `单日条目数由 ${earlyAvg.toFixed(0)} 条升至 ${last} 条，增速 ${(growthRate * 100).toFixed(0)}%`
    : "数据不足，暂无法计算趋势";

  const toDist = <T extends string>(map: Record<T, number>): Distribution<T>[] =>
    (Object.keys(map) as T[]).map((key) => ({ key, count: map[key], ratio: ratio(map[key], total) }));

  return {
    total,
    sentiment: toDist(sentimentCount),
    risk: RISK_ORDER.map((key) => ({ key, count: riskCount[key], ratio: ratio(riskCount[key], total) })),
    topics: [...topicCount.entries()]
      .map(([key, count]) => ({ key, count, ratio: ratio(count, total) }))
      .sort((a, b) => b.count - a.count),
    keywords: [...keywordCount.entries()]
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
      .slice(0, 12),
    trend,
    sources: [...sourceCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    needReview,
    corrected: correctedIds.size,
    failed,
    timeUnknown,
    avgConfidence: total ? confSum / total : 0,
    recentNegativeRatio,
    growthRate,
    trendNote: peak.label !== "-" ? `${trendNote}，峰值出现在 ${peak.label}（${peak.total} 条）` : trendNote,
  };
}

/** 诉求类表达的命中比例，用于风险维度「诉求集中度」 */
export function complaintRatio(
  items: OpinionItem[],
  results: Map<string, AnalysisResult>
): { ratio: number; ids: string[] } {
  const ids = items
    .filter((it) => {
      const r = results.get(it.id);
      return r ? r.risk_reasons.some((x) => /诉求|投诉|维权|质疑/.test(x)) : false;
    })
    .map((it) => it.id);
  return { ratio: ratio(ids.length, items.length), ids };
}

export function dominantSentiment(d: Distribution<Sentiment>[]): Sentiment {
  return d.reduce((m, x) => (x.count > m.count ? x : m), d[0]).key;
}
