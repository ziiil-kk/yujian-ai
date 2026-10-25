// 舆见 AI —— 分析编排
//
// 这一层把「规则引擎」和「模型」组合起来，并且保证两件产品原则：
//   1. AI 给建议，人做决定：模型输出的每一项都可被人工覆盖
//   2. 结论必须有依据：没有数据支撑的结论不输出

import {
  analyzeByRules,
  computeRiskDimensions,
  extractSignals,
  type RiskDimension,
} from "./rules";
import { buildRepairHint, PROMPT_VERSION, validateAnalysis } from "./schema";
import { computeStats, complaintRatio, type DatasetStats } from "./stats";
import { P1_SYSTEM, p1User, P2_SYSTEM, p2User, P3_SYSTEM, p3User, P4_SYSTEM, p4User } from "./prompts";
import { chatJSON, getLLMConfig } from "./llm";
import type {
  AnalysisResult,
  Cluster,
  Correction,
  OpinionItem,
  Report,
  ReportSection,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
  Sentiment,
} from "./types";
import { RISK_LABEL } from "./types";

export const ENGINE_LIVE = "真实模型";
export const ENGINE_MOCK = "规则引擎 (mock)";

/* ================================================================== *
 * 单条分析
 * ================================================================== */

export async function analyzeItem(item: OpinionItem): Promise<AnalysisResult> {
  const cfg = getLLMConfig();
  const fallback = () => analyzeByRules(item.content, item.title);

  const payload = {
    title: item.title,
    content: item.content,
    source: item.source,
    publishedAt: item.publishedAt,
  };

  if (!cfg.live) return fallback();

  // 第一次调用
  let res = await chatJSON(P1_SYSTEM, p1User(payload), { maxTokens: 700 });
  if (res.ok) {
    const v = validateAnalysis(res.data, item.content, ENGINE_LIVE);
    if (v.ok && v.value) return v.value;
    // 结构校验失败：把错误原样回传给模型再试一次，比让它猜有效得多
    res = await chatJSON(P1_SYSTEM, p1User(payload), {
      maxTokens: 700,
      repairHint: buildRepairHint(v.errors, v.warnings),
    });
    if (res.ok) {
      const retry = validateAnalysis(res.data, item.content, ENGINE_LIVE);
      if (retry.ok && retry.value) return retry.value;
    }
  }

  // 降级：模型不可用时回落到规则引擎，并标记需人工确认
  const fb = fallback();
  return { ...fb, need_human_review: true };
}

export interface BatchOutcome {
  results: Map<string, AnalysisResult>;
  failed: { id: string; reason: string }[];
}

/** 简单并发池：控制并发数，避免触发限流 */
export async function analyzeBatch(
  items: OpinionItem[],
  concurrency = 4,
  onProgress?: (done: number, total: number) => void
): Promise<BatchOutcome> {
  const results = new Map<string, AnalysisResult>();
  const failed: { id: string; reason: string }[] = [];
  let done = 0;

  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const it = queue.shift();
      if (!it) return;
      try {
        const r = await analyzeItem(it);
        results.set(it.id, r);
      } catch (e) {
        failed.push({ id: it.id, reason: e instanceof Error ? e.message : String(e) });
      }
      done += 1;
      onProgress?.(done, items.length);
    }
  });

  await Promise.all(workers);
  return { results, failed };
}

/* ================================================================== *
 * 观点聚类
 * ================================================================== */

// 观点标题映射：把命中的信号词翻译成可读的观点标题。
// 这样即使是模拟模式，聚类结果也是稳定且像样的。
const PHRASE_RULES: { terms: string[]; title: string; description: string }[] = [
  {
    terms: ["就业", "岗位", "裁员", "失业", "替代人工", "替代人", "求职", "替代"],
    title: "担忧就业替代加剧",
    description: "认为 AI 加速替代基础岗位，且企业未与从业者充分协商。",
  },
  {
    terms: ["幻觉", "虚假", "误导", "编造", "错误", "不准确", "医疗", "诊断"],
    title: "质疑内容真实性与幻觉风险",
    description: "认为生成内容缺乏可靠校验，在专业场景存在误导风险。",
  },
  {
    terms: ["监管", "合规", "备案", "标识", "处罚", "约谈", "立法", "条例"],
    title: "关注监管落地节奏与合规成本",
    description: "关注监管要求带来的合规成本与落地时间表。",
  },
  {
    terms: ["歧视", "偏见", "公平", "不公"],
    title: "质疑算法公平性",
    description: "认为算法决策在招聘、信贷等场景存在不公平对待。",
  },
  {
    terms: ["隐私", "个人信息", "泄露", "授权", "数据安全"],
    title: "担忧数据隐私与安全",
    description: "担心训练与使用过程中对个人信息的采集与保护。",
  },
  {
    terms: ["算力", "芯片", "供应链", "断供", "制裁"],
    title: "关注算力与供应链约束",
    description: "关注算力供给、芯片供应对产业发展的制约。",
  },
  {
    terms: ["成本", "定价", "付费", "价格"],
    title: "关注成本与商业化可行性",
    description: "关注推理成本、定价策略与商业模式的可持续性。",
  },
  {
    terms: ["融资", "估值", "营收", "亏损", "上市", "财报"],
    title: "关注融资与商业化前景",
    description: "关注资本环境变化对行业发展的影响。",
  },
  {
    terms: ["开源", "权重", "生态", "社区"],
    title: "看好开源生态带来的机会",
    description: "认为开源路线降低了使用门槛，带动生态繁荣。",
  },
  {
    terms: ["效率", "降本", "增效", "提升", "赋能", "落地"],
    title: "看好降本增效带来的产业机会",
    description: "认为成本下降与效率提升会推动更多行业接入。",
  },
  {
    terms: ["竞争", "份额", "格局", "超越", "赶超", "出海"],
    title: "关注行业竞争格局变化",
    description: "关注厂商之间在技术路线与市场份额上的竞争。",
  },
  {
    terms: ["未成年人", "青少年", "儿童", "学生"],
    title: "担忧对未成年人的影响",
    description: "担心未成年人在使用中接触到不适宜内容或产生依赖。",
  },
];

function clusterByRules(items: OpinionItem[], results: Map<string, AnalysisResult>): Cluster[] {
  const buckets = new Map<string, { rule?: (typeof PHRASE_RULES)[number]; ids: string[] }>();

  for (const it of items) {
    const r = results.get(it.id);
    if (!r) continue;
    const text = `${it.title} ${it.content}`;
    const rule = PHRASE_RULES.find((p) => p.terms.some((t) => text.includes(t)));
    const key = rule?.title ?? "其他讨论";
    const bucket = buckets.get(key) ?? { rule, ids: [] };
    bucket.ids.push(it.id);
    buckets.set(key, bucket);
  }

  const clusters: Cluster[] = [...buckets.entries()]
    .map(([title, b]) => {
      const dist: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
      for (const id of b.ids) {
        const r = results.get(id);
        if (r) dist[r.sentiment] += 1;
      }
      const rep = b.ids
        .slice()
        .sort((a, b2) => {
          const ra = results.get(a);
          const rb = results.get(b2);
          return (rb?.risk_reasons.length ?? 0) - (ra?.risk_reasons.length ?? 0);
        })
        .slice(0, 3);
      return {
        id: `cl_${title.length}_${b.ids.length}`,
        title,
        description: b.rule?.description ?? "未能归类的零散讨论。",
        itemIds: b.ids,
        itemCount: b.ids.length,
        sentimentDistribution: dist,
        representativeItemIds: rep,
      };
    })
    .filter((c) => c.itemCount >= 2)
    .sort((a, b) => b.itemCount - a.itemCount)
    .slice(0, 6);

  return clusters;
}

export async function buildClusters(
  items: OpinionItem[],
  results: Map<string, AnalysisResult>
): Promise<{ clusters: Cluster[]; engine: string; note?: string }> {
  // 样本不足时不做聚类 —— 少于 8 条的数据强行聚类只会产出误导性结论
  if (items.length < 8) {
    return {
      clusters: [],
      engine: ENGINE_MOCK,
      note: `样本量仅 ${items.length} 条，不足 8 条，已跳过聚类，直接展示单条观点。`,
    };
  }

  const cfg = getLLMConfig();
  if (cfg.live) {
    const rows = items.slice(0, 120).map((it) => ({
      id: it.id,
      topic: results.get(it.id)?.topic ?? "其他",
      sentiment: results.get(it.id)?.sentiment ?? "neutral",
      opinion: results.get(it.id)?.opinion ?? "",
    }));
    const res = await chatJSON(P2_SYSTEM, p2User(rows), { maxTokens: 1600 });
    if (res.ok && res.data) {
      const d = res.data as { clusters?: unknown };
      if (Array.isArray(d.clusters)) {
        const parsed = parseClusters(d.clusters, items, results);
        if (parsed.length) return { clusters: parsed, engine: ENGINE_LIVE };
      }
    }
  }

  return { clusters: clusterByRules(items, results), engine: ENGINE_MOCK };
}

/** 校验模型返回的聚类：id 必须真实存在，否则丢弃；防止编造条目 */
function parseClusters(
  raw: unknown[],
  items: OpinionItem[],
  results: Map<string, AnalysisResult>
): Cluster[] {
  const valid = new Set(items.map((i) => i.id));
  const out: Cluster[] = [];

  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const title = String(o.title ?? "").trim().slice(0, 20);
    const ids = Array.isArray(o.item_ids)
      ? o.item_ids.filter((x): x is string => typeof x === "string" && valid.has(x))
      : [];
    if (!title || ids.length < 2) continue;

    const dist: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
    for (const id of ids) {
      const r = results.get(id);
      if (r) dist[r.sentiment] += 1;
    }
    out.push({
      id: `cl_${out.length}`,
      title,
      description: String(o.description ?? "").trim().slice(0, 60),
      itemIds: ids,
      itemCount: ids.length,
      sentimentDistribution: dist,
      representativeItemIds: ids.slice(0, 3),
    });
  }

  return out.sort((a, b) => b.itemCount - a.itemCount).slice(0, 6);
}

/* ================================================================== *
 * 风险研判
 * ================================================================== */

export interface RiskOutcome {
  assessment: RiskAssessment;
  weightedScore: number;
}

export async function assessRisk(
  items: OpinionItem[],
  results: Map<string, AnalysisResult>,
  clusters: Cluster[],
  stats: DatasetStats,
  corrections: Correction[]
): Promise<RiskOutcome> {
  const negative = stats.sentiment.find((s) => s.key === "negative")?.count ?? 0;

  // 最大的负面观点：观点一致性维度看的是「负面是否形成共识」
  const negativeClusters = clusters
    .filter((c) => c.sentimentDistribution.negative > c.sentimentDistribution.positive)
    .sort((a, b) => b.itemCount - a.itemCount);
  const topNeg = negativeClusters[0];
  const singleNegativeClusterShare = topNeg && negative > 0 ? topNeg.itemCount / negative : 0;

  const appeal = complaintRatio(items, results);
  const sensitiveTags = new Set<string>();
  const sensitiveIds: string[] = [];
  for (const it of items) {
    const s = extractSignals(`${it.title} ${it.content}`);
    if (s.sensitiveHits.length) {
      s.sensitiveHits.forEach((t) => sensitiveTags.add(t));
      sensitiveIds.push(it.id);
    }
  }

  // 近 3 日条目
  const sorted = items.slice().sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  const recentIds = sorted.slice(0, Math.max(5, Math.round(items.length * 0.25))).map((i) => i.id);

  const ctx = {
    total: stats.total,
    negative,
    singleNegativeClusterShare,
    singleNegativeClusterTitle: topNeg?.title ?? "无",
    complaintRatio: appeal.ratio,
    growthRate: stats.growthRate,
    sensitiveTags: [...sensitiveTags],
    recentNegativeRatio: stats.recentNegativeRatio,
    trendNote: stats.trendNote,
  };

  const negativeIds = items.filter((i) => results.get(i.id)?.sentiment === "negative").map((i) => i.id);
  const { dimensions, overall } = computeRiskDimensions(ctx, {
    negative: negativeIds,
    topNegativeCluster: topNeg?.itemIds ?? [],
    complaint: appeal.ids,
    sensitive: sensitiveIds,
    recent: recentIds,
  });

  const weightedScore =
    dimensions[0].score * 0.28 +
    dimensions[1].score * 0.22 +
    dimensions[2].score * 0.2 +
    dimensions[3].score * 0.15 +
    dimensions[4].score * 0.15;

  // 待人工确认：低置信度 + 高风险 + 涉及具体对象
  const reviewIds = items
    .filter((it) => {
      const r = results.get(it.id);
      if (!r) return false;
      return r.need_human_review || r.risk_level === "critical" || r.risk_level === "high";
    })
    .map((it) => it.id)
    .slice(0, 20);

  const watchlist = items
    .filter((it) => results.get(it.id)?.risk_level === "critical" || results.get(it.id)?.risk_level === "high")
    .sort((a, b) => {
      const oa = results.get(a.id)!;
      const ob = results.get(b.id)!;
      const rank: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return rank[oa.risk_level] - rank[ob.risk_level];
    })
    .map((it) => it.id)
    .slice(0, 8);

  // 模型只负责把算好的数字翻译成判断与话术
  let headline = buildHeadline(overall, topNeg?.title, sensitiveTags.size);
  let factors: RiskFactor[] = dimensions.map(toFactor);
  let engine = ENGINE_MOCK;

  const cfg = getLLMConfig();
  if (cfg.live) {
    const res = await chatJSON(
      P3_SYSTEM,
      p3User({
        total: stats.total,
        dimensions: dimensions.map((d) => ({
          label: d.label,
          score: d.score,
          conclusion: d.conclusion,
          evidence: d.evidence,
        })),
        weightedScore,
        topNegativeCluster: topNeg?.title,
        humanReviewCount: reviewIds.length,
      }),
      { maxTokens: 900 }
    );
    if (res.ok && res.data) {
      const d = res.data as Record<string, unknown>;
      const lvl = String(d.overall_level ?? "") as RiskLevel;
      if (["low", "medium", "high", "critical"].includes(lvl)) {
        headline = String(d.headline ?? headline).slice(0, 80);
        const fs = Array.isArray(d.factors) ? d.factors : [];
        const parsed: RiskFactor[] = fs
          .map((f, i) => {
            const o = (f ?? {}) as Record<string, unknown>;
            const base = dimensions[i] ?? dimensions[0];
            return {
              dimension: String(o.dimension ?? base.label),
              conclusion: String(o.conclusion ?? base.conclusion),
              evidence: String(o.evidence ?? base.evidence),
              score: base.score,
              // 关联样本始终来自系统的确定性归属，不由模型指定
              itemIds: base.itemIds,
            };
          })
          .filter((f) => f.conclusion);
        if (parsed.length >= 3) factors = parsed.slice(0, 6);
        engine = ENGINE_LIVE;
      }
    }
  }

  const assessment: RiskAssessment = {
    overallLevel: overall,
    headline,
    factors,
    watchlistItemIds: watchlist,
    humanReviewItemIds: reviewIds,
    generatedAt: new Date().toISOString(),
    confirmed: false,
    engine,
  };

  // 已有人工确认过则保留确认状态
  void corrections;

  return { assessment, weightedScore };
}

function toFactor(d: RiskDimension): RiskFactor {
  return {
    dimension: d.label,
    conclusion: d.conclusion,
    evidence: d.evidence,
    score: d.score,
    itemIds: d.itemIds.slice(0, 60),
  };
}

function buildHeadline(level: RiskLevel, topCluster: string | undefined, sensitiveCount: number): string {
  const lvl = RISK_LABEL[level];
  if (!topCluster) {
    return `综合风险等级为${lvl}。当前数据中尚未形成明显的集中负面观点，建议保持常规监测。`;
  }
  return `综合风险等级为${lvl}。负面情绪集中于「${topCluster}」，涉及 ${sensitiveCount} 类敏感议题，观点一致性较高，存在扩散风险。`;
}

/* ================================================================== *
 * 简报生成
 * ================================================================== */

export async function buildReport(
  stats: DatasetStats,
  clusters: Cluster[],
  assessment: RiskAssessment,
  corrections: Correction[],
  range: { start: string; end: string }
): Promise<Report> {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const sent = (k: Sentiment) => stats.sentiment.find((s) => s.key === k)?.count ?? 0;
  const topTopics = stats.topics.slice(0, 3).map((t) => t.key).join("、") || "暂无明显集中主题";
  const topNegCluster = clusters
    .slice()
    .sort((a, b) => b.sentimentDistribution.negative - a.sentimentDistribution.negative)[0];
  const topClusters = clusters.slice(0, 3).map((c) => ({ title: c.title, count: c.itemCount }));

  const sections: ReportSection[] = [
    {
      key: "overview",
      title: "一、事件概况",
      content: `${range.start} 至 ${range.end} 期间，共采集并去重后保留 AI 相关舆情 ${stats.total} 条，覆盖 ${stats.sources.length} 个来源。讨论主要集中在${topTopics}三类议题。${stats.failed > 0 ? `另有 ${stats.failed} 条因分析失败未计入统计。` : ""}`,
      citations: ["stats.total", "stats.sources"],
      generated: false,
    },
    {
      key: "focus",
      title: "二、舆论焦点",
      content: clusters.length
        ? `舆论呈现 ${clusters.length} 个主要焦点：${clusters
            .slice(0, 3)
            .map((c) => `「${c.title}」（${c.itemCount} 条）`)
            .join("；")}。`
        : "当前样本量不足以形成稳定的观点聚类，建议补充数据后再行判断。",
      citations: clusters.slice(0, 3).map((c) => c.id),
      generated: false,
    },
    {
      key: "sentiment",
      title: "三、情绪倾向",
      content: `负面 ${sent("negative")} 条占 ${pct(
        stats.sentiment.find((s) => s.key === "negative")?.ratio ?? 0
      )}，中性 ${sent("neutral")} 条占 ${pct(
        stats.sentiment.find((s) => s.key === "neutral")?.ratio ?? 0
      )}，正面 ${sent("positive")} 条占 ${pct(
        stats.sentiment.find((s) => s.key === "positive")?.ratio ?? 0
      )}。近 3 日负面占比为 ${pct(stats.recentNegativeRatio)}，${
        stats.recentNegativeRatio > (stats.sentiment.find((s) => s.key === "negative")?.ratio ?? 0)
          ? "较整体水平继续走高，情绪呈恶化趋势"
          : "与整体水平基本持平"
      }。`,
      citations: ["stats.sentiment"],
      generated: false,
    },
    {
      key: "opinions",
      title: "四、主要观点",
      content: clusters.length
        ? clusters
            .slice(0, 4)
            .map(
              (c) =>
                `${c.title}：涉及 ${c.itemCount} 条，其中负面 ${c.sentimentDistribution.negative} 条。${c.description}`
            )
            .join(" ")
        : "样本量不足，暂不归纳观点。",
      citations: clusters.slice(0, 4).map((c) => c.id),
      generated: false,
    },
    {
      key: "trend",
      title: "五、舆情趋势",
      content: stats.trend.length
        ? `${stats.trendNote}。趋势拐点与「${topNegCluster?.title ?? "主要议题"}」的集中出现时间基本吻合。`
        : "时间字段不足，暂无法绘制趋势。",
      citations: ["stats.trend"],
      generated: false,
    },
    {
      key: "risk",
      title: "六、风险研判",
      content: `综合风险等级为${RISK_LABEL[assessment.overallLevel]}。${assessment.headline.replace(
        /^综合风险等级为.{1,3}。/,
        ""
      )}主要判断依据：${assessment.factors
        .slice(0, 4)
        .map((f) => f.conclusion.replace(/。$/, ""))
        .join("；")}。`,
      citations: assessment.factors.map((f) => f.dimension),
      generated: false,
    },
  ];

  // 第七段是唯一允许模型自由表述的部分，并强制标注「待人工确认」
  const sensitiveTags = assessment.factors.find((f) => f.dimension === "对象敏感度")?.conclusion ?? "";
  let advice = buildAdvice(stats, assessment, topClusters, sensitiveTags);
  let engine = ENGINE_MOCK;

  const cfg = getLLMConfig();
  if (cfg.live) {
    const res = await chatJSON(
      P4_SYSTEM,
      p4User({
        total: stats.total,
        range: `${range.start} 至 ${range.end}`,
        negativeRatio: stats.sentiment.find((s) => s.key === "negative")?.ratio ?? 0,
        riskLevel: RISK_LABEL[assessment.overallLevel],
        topClusters,
        sensitiveTags: sensitiveTags ? [sensitiveTags] : [],
        trendNote: stats.trendNote,
      }),
      { maxTokens: 500 }
    );
    if (res.ok && res.data) {
      const c = (res.data as Record<string, unknown>).content;
      if (typeof c === "string" && c.trim().length > 20) {
        advice = c.trim().slice(0, 400);
        engine = ENGINE_LIVE;
      }
    }
  }

  sections.push({
    key: "advice",
    title: "七、建议关注事项",
    content: advice,
    citations: ["generated"],
    generated: true,
  });

  return {
    sections,
    generatedAt: new Date().toISOString(),
    includedCorrections: corrections.length,
    engine,
  };
}

function buildAdvice(
  stats: DatasetStats,
  assessment: RiskAssessment,
  topClusters: { title: string; count: number }[],
  sensitive: string
): string {
  const parts: string[] = [];
  if (topClusters[0]) {
    parts.push(`重点跟踪「${topClusters[0].title}」的后续走向与相关方表态`);
  }
  const negRatio = stats.sentiment.find((s) => s.key === "negative")?.ratio ?? 0;
  const target = Math.max(20, Math.round((negRatio - 0.08) * 100));
  parts.push(`下一周期对比负面占比是否回落至 ${target}% 以下，作为情绪是否缓和的判断标准`);
  if (sensitive) {
    parts.push("涉及具体企业与个人的负面表达，建议人工核实后再引用");
  }
  if (assessment.humanReviewItemIds.length > 0) {
    parts.push(`当前有 ${assessment.humanReviewItemIds.length} 条标记为待人工确认，建议在对外使用前完成复核`);
  }
  return `${parts.join("；")}。`;
}

export { PROMPT_VERSION };
