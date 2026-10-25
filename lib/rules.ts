// 舆见 AI —— 确定性规则引擎
//
// 这一个文件承担两个职责，这也是本项目的核心设计决策之一：
//   1. 模拟数据模式的单条分析（保证演示不依赖网络、且结果可复现）
//   2. 真实模式下「风险五维度」的指标计算
//
// 为什么风险研判不交给模型读原文去判断：
// 让模型读一堆文本「拍脑袋」得出的风险等级，不可控、不可复现、不可解释，还很贵。
// 正确做法是——系统用确定性规则算出各维度指标，模型只负责把数字翻译成判断和话术。
// 所以真实模式和模拟模式的风险等级，用的是同一套规则。

import {
  TOPICS,
  type AnalysisResult,
  type RiskLevel,
  type Sentiment,
  type Topic,
} from "./types";
import { PROMPT_VERSION } from "./schema";

/* ------------------------------------------------------------------ *
 * 词表
 * ------------------------------------------------------------------ */

const NEG_TERMS: Record<string, number> = {
  替代: 2, 失业: 3, 裁员: 3, 维权: 3, 投诉: 3, 抵制: 3, 起诉: 3, 索赔: 3,
  质疑: 2, 争议: 2, 造假: 3, 虚假: 3, 误导: 3, 歧视: 3, 泄露: 3, 违规: 3,
  违规采集: 3, 事故: 3, 崩塌: 3, 停用: 2, 下架: 2, 封禁: 2, 处罚: 2, 罚款: 2,
  风险: 1, 隐患: 2, 担忧: 2, 反对: 2, 不满: 2, 抱怨: 2, 挤压: 1, 冲击: 2,
  冲击就业: 3, 侵权: 3, 抄袭: 2, 幻觉: 2, 失真: 2, 错误: 2, 失控: 3,
  门槛: 1, 成本高: 2, 门槛高: 2, 不透明: 2, 黑箱: 2, 偏见: 3, 骗局: 3,
  夸大: 2, 泡沫: 2, 断供: 3, 依赖: 1, 隐私: 2, 深度伪造: 3, 诈骗: 3,
  未成年人: 2, 安全漏洞: 3, 未协商: 3, 集体: 2, 抗议: 3,
};

const POS_TERMS: Record<string, number> = {
  突破: 3, 领先: 2, 提升: 2, 提升效率: 2, 降本: 2, 增效: 2, 增长: 2, 增长快: 2,
  开源: 2, 落地: 2, 赋能: 2, 创新: 2, 认可: 2, 好评: 2, 获奖: 2, 完成: 1,
  上线: 1, 发布: 1, 合作: 2, 达成: 2, 优化: 1, 改善: 2, 领先水平: 3,
  国产替代: 2, 成本下降: 3, 效率提升: 3, 加速: 2, 受益: 2, 扩张: 2,
  超预期: 3, 里程碑: 3, 突破性: 3,
};

/** 诉求类表达：出现即计入「诉求集中度」维度 */
const COMPLAINT_TERMS = [
  "投诉", "维权", "起诉", "索赔", "抵制", "抗议", "质疑", "不满", "要求",
  "道歉", "整改", "退款", "赔偿", "曝光", "点名", "举报",
];

/** 高敏感对象：出现即拉高「对象敏感度」维度 */
const SENSITIVE_TAGS: { tag: string; terms: string[] }[] = [
  { tag: "就业", terms: ["就业", "岗位", "裁员", "失业", "替代人工", "替代人", "求职"] },
  { tag: "医疗", terms: ["医疗", "诊断", "处方", "患者", "医药", "临床"] },
  { tag: "算法歧视", terms: ["歧视", "偏见", "公平性", "不公", "差别对待"] },
  { tag: "监管", terms: ["监管", "合规", "征求意见", "处罚", "约谈", "立法", "条例"] },
  { tag: "隐私", terms: ["隐私", "个人信息", "数据泄露", "授权", "采集个人信息"] },
  { tag: "未成年人", terms: ["未成年人", "青少年", "儿童", "学生"] },
  { tag: "财务", terms: ["财报", "亏损", "营收", "融资", "估值", "上市"] },
];

/** 规模化表达：出现「上千人」「超过两千人」这类量词会显著抬高风险 */
const SCALE_PATTERN = /(数万|上万|数千|上千|数百|上百|超过[一二三四五六七八九十百千万]+(人|家|个|起)|[0-9]+(人|家|个|起)(被|已|受|涉及))/;

/** 热度表达 */
const HEAT_TERMS = ["发酵", "升温", "刷屏", "热搜", "爆", "扩散", "连锁反应", "集中出现"];

const TOPIC_RULES: { topic: Topic; terms: string[] }[] = [
  {
    topic: "技术进展",
    terms: ["模型", "参数", "训练", "推理", "算力", "芯片", "开源", "权重", "算法", "架构", "微调", "多模态", "上下文", "上下文窗口", "性能", "基准"],
  },
  {
    topic: "产品发布",
    terms: ["发布", "上线", "推出", "新版", "升级", "开放", "公测", "接入", "功能", "助手", "智能体"],
  },
  {
    topic: "商业化与融资",
    terms: ["融资", "估值", "营收", "订单", "付费", "定价", "成本", "商业化", "市场", "客户", "上市", "亏损", "财报"],
  },
  {
    topic: "政策与监管",
    terms: ["监管", "政策", "征求意见", "法规", "条例", "备案", "标识", "合规", "处罚", "约谈", "标准", "立法", "安全评估"],
  },
  {
    topic: "行业竞争",
    terms: ["竞争", "份额", "对手", "超越", "反超", "国产", "海外", "出海", "价格战", "格局", "差距", "赶超"],
  },
  {
    topic: "社会影响与伦理",
    terms: ["就业", "岗位", "裁员", "失业", "伦理", "隐私", "歧视", "偏见", "未成年人", "社会", "信任", "替代", "冲击", "公众", "舆论"],
  },
  {
    topic: "用户反馈与体验",
    terms: ["用户", "体验", "反馈", "投诉", "客服", "评价", "好评", "差评", "门槛", "订阅", "续费", "教程"],
  },
];

/* ------------------------------------------------------------------ *
 * 文本工具
 * ------------------------------------------------------------------ */

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?;\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countHits(text: string, terms: string[]): { term: string; n: number }[] {
  const out: { term: string; n: number }[] = [];
  for (const t of terms) {
    let n = 0;
    let idx = text.indexOf(t);
    while (idx !== -1) {
      n += 1;
      idx = text.indexOf(t, idx + t.length);
    }
    if (n > 0) out.push({ term: t, n });
  }
  return out;
}

function sumWeight(text: string, dict: Record<string, number>) {
  let score = 0;
  const hits: string[] = [];
  for (const [term, weight] of Object.entries(dict)) {
    if (text.includes(term)) {
      score += weight;
      hits.push(term);
    }
  }
  return { score, hits };
}

/* ------------------------------------------------------------------ *
 * 单条分析
 * ------------------------------------------------------------------ */

export interface RuleSignals {
  negativeHits: string[];
  positiveHits: string[];
  complaintHits: string[];
  sensitiveHits: string[];
  heatHits: string[];
  hasScale: boolean;
  topic: Topic;
  topicHits: string[];
  keywordCandidates: { term: string; n: number }[];
}

export function extractSignals(text: string): RuleSignals {
  const neg = sumWeight(text, NEG_TERMS);
  const pos = sumWeight(text, POS_TERMS);

  let bestTopic: Topic = "其他";
  let bestCount = 0;
  let bestHits: string[] = [];
  for (const rule of TOPIC_RULES) {
    const hits = rule.terms.filter((t) => text.includes(t));
    if (hits.length > bestCount) {
      bestCount = hits.length;
      bestTopic = rule.topic;
      bestHits = hits;
    }
  }

  const complaintHits = COMPLAINT_TERMS.filter((t) => text.includes(t));
  const sensitiveHits = SENSITIVE_TAGS.filter((s) =>
    s.terms.some((t) => text.includes(t))
  ).map((s) => s.tag);
  const heatHits = HEAT_TERMS.filter((t) => text.includes(t));

  const keywordCandidates = countHits(text, [
    ...Object.keys(NEG_TERMS),
    ...Object.keys(POS_TERMS),
    ...bestHits,
    ...complaintHits,
  ]).sort((a, b) => b.n - a.n || b.term.length - a.term.length);

  return {
    negativeHits: neg.hits,
    positiveHits: pos.hits,
    complaintHits,
    sensitiveHits,
    heatHits,
    hasScale: SCALE_PATTERN.test(text),
    topic: bestTopic,
    topicHits: bestHits,
    keywordCandidates,
  };
}

function pickEvidence(text: string, terms: string[]): string[] {
  const sentences = splitSentences(text);
  const scored = sentences
    .map((s) => ({
      s,
      hits: terms.filter((t) => s.includes(t)).length + (SCALE_PATTERN.test(s) ? 1 : 0),
    }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const top = scored.slice(0, 2).map((x) => x.s.trim());
  if (top.length === 0 && sentences.length) top.push(sentences[0].trim());
  return top.map((s) => (s.length > 60 ? s.slice(0, 60) : s));
}

function riskFromSignals(
  sentiment: Sentiment,
  s: RuleSignals,
  text: string
): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let points = 0;

  if (sentiment === "negative") { points += 2; reasons.push("文本整体呈负面表达"); }
  if (s.complaintHits.length >= 2) {
    points += 2;
    reasons.push(`包含明确的诉求表达（${s.complaintHits.slice(0, 3).join("、")}）`);
  } else if (s.complaintHits.length === 1) {
    points += 1;
    reasons.push(`出现诉求表达（${s.complaintHits[0]}）`);
  }
  if (s.sensitiveHits.length >= 2) {
    points += 2;
    reasons.push(`同时涉及 ${s.sensitiveHits.join("、")} 等高敏感议题`);
  } else if (s.sensitiveHits.length === 1) {
    points += 1;
    reasons.push(`涉及高敏感议题：${s.sensitiveHits[0]}`);
  }
  if (s.hasScale) {
    points += 2;
    reasons.push("文本给出涉及人数或机构的具体规模，具备放大传播的条件");
  }
  if (s.heatHits.length > 0) {
    points += 1;
    reasons.push(`出现热度升温相关表述（${s.heatHits.slice(0, 2).join("、")}）`);
  }

  let level: RiskLevel = "low";
  if (points >= 6) level = "critical";
  else if (points >= 4) level = "high";
  else if (points >= 2) level = "medium";

  if (level === "low") return { level, reasons: [] };
  return { level, reasons: reasons.slice(0, 3) };
}

const OPINION_TEMPLATES: Record<Sentiment, (topic: Topic) => string> = {
  negative: (t) => `对${t}相关进展表达担忧或批评`,
  neutral: (t) => `客观陈述${t}相关事实与进展`,
  positive: (t) => `看好${t}带来的机会与改善`,
};

/** 模拟数据模式的单条分析：完全确定性，同样输入永远同样输出 */
export function analyzeByRules(
  content: string,
  title?: string
): AnalysisResult {
  const text = `${title ?? ""} ${content}`;
  const s = extractSignals(text);
  const { score } = sumWeight(text, NEG_TERMS);
  const { score: posScore } = sumWeight(text, POS_TERMS);
  const net = score - posScore;

  let sentiment: Sentiment = "neutral";
  if (net >= 2) sentiment = "negative";
  else if (net <= -2) sentiment = "positive";

  const margin = Math.abs(net);
  const confidence = Math.min(0.95, 0.58 + margin * 0.045);

  const { level, reasons } = riskFromSignals(sentiment, s, text);

  const firstSentence = splitSentences(content)[0] ?? content;
  const summary = firstSentence.length > 78 ? `${firstSentence.slice(0, 78)}…` : firstSentence;

  const keywords = s.keywordCandidates.slice(0, 5).map((k) => k.term);
  if (keywords.length < 2 && s.topicHits.length) {
    for (const t of s.topicHits) if (!keywords.includes(t)) keywords.push(t);
  }

  return {
    sentiment,
    sentiment_confidence: Number(confidence.toFixed(2)),
    topic: s.topic,
    topic_confidence: Number(Math.min(0.95, 0.6 + s.topicHits.length * 0.05).toFixed(2)),
    summary,
    keywords: keywords.slice(0, 6),
    opinion: OPINION_TEMPLATES[sentiment](s.topic),
    risk_level: level,
    risk_reasons: reasons,
    evidence_quotes: level === "low" ? [] : pickEvidence(content, [...s.complaintHits, ...s.sensitiveHits]),
    need_human_review: confidence < 0.6 || level === "critical",
    engine: "规则引擎 (mock)",
    promptVersion: PROMPT_VERSION,
    analyzedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * 数据集级指标：风险五维度
 * ------------------------------------------------------------------ */

export interface RiskDimension {
  key: string;
  label: string;
  score: number;
  conclusion: string;
  evidence: string;
  itemIds: string[];
}

export interface RiskContext {
  total: number;
  negative: number;
  singleNegativeClusterShare: number;
  singleNegativeClusterTitle: string;
  complaintRatio: number;
  growthRate: number;
  sensitiveTags: string[];
  recentNegativeRatio: number;
  trendNote: string;
}

/** 五个维度各自的打分规则。分数是「证据强度」，不是模型的主观感受。 */
export function computeRiskDimensions(
  ctx: RiskContext,
  itemIdsByTag: Record<string, string[]>
): { dimensions: RiskDimension[]; overall: RiskLevel } {
  const dims: RiskDimension[] = [];

  const negRatio = ctx.total > 0 ? ctx.negative / ctx.total : 0;
  dims.push({
    key: "emotion",
    label: "情绪恶化度",
    score: Math.round(Math.min(100, negRatio * 100 * 1.6)),
    conclusion: `负面占比 ${(negRatio * 100).toFixed(1)}%，近 3 日升至 ${(ctx.recentNegativeRatio * 100).toFixed(0)}%`,
    evidence: `负面 ${ctx.negative} / 总计 ${ctx.total}；判定口径：>40% 记中，>60% 记高`,
    itemIds: itemIdsByTag.negative ?? [],
  });

  dims.push({
    key: "consistency",
    label: "观点一致性",
    score: Math.round(Math.min(100, ctx.singleNegativeClusterShare * 100)),
    conclusion: `单一负面观点占负面样本 ${(ctx.singleNegativeClusterShare * 100).toFixed(0)}%`,
    evidence: `主要负面观点「${ctx.singleNegativeClusterTitle}」覆盖 ${itemIdsByTag.topNegativeCluster?.length ?? 0} 条 / 负面共 ${ctx.negative} 条；占比越高说明已形成共识而非零散抱怨`,
    itemIds: itemIdsByTag.topNegativeCluster ?? [],
  });

  dims.push({
    key: "heat",
    label: "传播热度",
    score: Math.round(Math.min(100, Math.max(0, ctx.growthRate) * 100)),
    conclusion: ctx.trendNote,
    evidence: `单日条目数增速 ${(ctx.growthRate * 100).toFixed(0)}%`,
    itemIds: itemIdsByTag.recent ?? [],
  });

  dims.push({
    key: "appeal",
    label: "诉求集中度",
    score: Math.round(Math.min(100, ctx.complaintRatio * 100 * 2)),
    conclusion: `投诉、维权、质疑类表达占比 ${(ctx.complaintRatio * 100).toFixed(0)}%`,
    evidence: `命中诉求词表的条目 ${itemIdsByTag.complaint?.length ?? 0} 条；判定口径：>30% 记中`,
    itemIds: itemIdsByTag.complaint ?? [],
  });

  dims.push({
    key: "sensitivity",
    label: "对象敏感度",
    score: Math.round(Math.min(100, ctx.sensitiveTags.length * 27)),
    conclusion: ctx.sensitiveTags.length
      ? `涉及 ${ctx.sensitiveTags.join("、")} 等 ${ctx.sensitiveTags.length} 类高敏感议题`
      : "未命中高敏感议题",
    evidence: `命中敏感议题标签 ${itemIdsByTag.sensitive?.length ?? 0} 条，涉及 ${ctx.sensitiveTags.length} 类；标签由规则匹配得出，不依赖模型主观判断`,
    itemIds: itemIdsByTag.sensitive ?? [],
  });

  const weighted =
    dims[0].score * 0.28 +
    dims[1].score * 0.22 +
    dims[2].score * 0.2 +
    dims[3].score * 0.15 +
    dims[4].score * 0.15;

  let overall: RiskLevel = "low";
  if (weighted >= 75) overall = "critical";
  else if (weighted >= 55) overall = "high";
  else if (weighted >= 32) overall = "medium";

  return { dimensions: dims, overall };
}

export { COMPLAINT_TERMS, SENSITIVE_TAGS, TOPIC_RULES, TOPICS };
