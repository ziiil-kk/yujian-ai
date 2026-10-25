// 舆见 AI —— AI 输出的结构化契约
//
// 为什么要有这一层：
// LLM 会返回一个「看起来像 JSON」的东西。如果前端直接吃它，一旦字段缺失或取值超出
// 枚举范围，页面就崩了。所以这里做三件事：
//   1. 枚举与范围校验
//   2. 归一化（把模型可能返回的同义值映射到规范值）
//   3. 跨字段一致性校验 —— 这部分「程序校验」不能交给模型自觉
//
// 最典型的一条：evidence_quotes 必须是原文的子串。这是防编造的硬约束。

import {
  TOPICS,
  type AnalysisResult,
  type RiskLevel,
  type Sentiment,
  type Topic,
} from "./types";

export const PROMPT_VERSION = "v0.3";

const SENTIMENT_ALIASES: Record<string, Sentiment> = {
  positive: "positive", pos: "positive", 正面: "positive", 积极: "positive",
  neutral: "neutral", neu: "neutral", 中性: "neutral", 客观: "neutral",
  negative: "negative", neg: "negative", 负面: "negative", 消极: "negative",
};

const RISK_ALIASES: Record<string, RiskLevel> = {
  low: "low", 低: "low", 低风险: "low",
  medium: "medium", mid: "medium", 中: "medium", 中风险: "medium",
  high: "high", 高: "high", 高风险: "high",
  critical: "critical", severe: "critical", 严重: "critical", 极高: "critical",
};

export interface ValidationResult {
  ok: boolean;
  value?: AnalysisResult;
  /** 可修复的问题：已归一化，但值得记录 */
  warnings: string[];
  /** 不可修复的问题：该条应标记失败或重试 */
  errors: string[];
}

function clamp01(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

function normalizeTopic(raw: unknown): Topic | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  const direct = TOPICS.find((x) => x === t);
  if (direct) return direct;
  const partial = TOPICS.find((x) => t.includes(x) || x.includes(t));
  return partial ?? null;
}

function asStringArray(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * 校验并归一化单条分析结果。
 * @param raw LLM 返回的原始对象
 * @param sourceText 该条的原文，用于校验 evidence_quotes 是否为子串
 */
export function validateAnalysis(
  raw: unknown,
  sourceText: string,
  engine: string
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { ok: false, warnings, errors: ["返回内容不是对象"] };
  }
  const o = raw as Record<string, unknown>;

  const sentiment = SENTIMENT_ALIASES[String(o.sentiment ?? "").trim().toLowerCase()];
  if (!sentiment) errors.push(`sentiment 取值非法: ${String(o.sentiment)}`);

  const topic = normalizeTopic(o.topic);
  if (!topic) errors.push(`topic 不在固定标签体系内: ${String(o.topic)}`);

  const riskLevel = RISK_ALIASES[String(o.risk_level ?? "").trim().toLowerCase()];
  if (!riskLevel) errors.push(`risk_level 取值非法: ${String(o.risk_level)}`);

  if (errors.length) return { ok: false, warnings, errors };

  // --- 以下为跨字段一致性校验 ---

  // 1) 依据必须是原文子串，否则丢弃。防止模型编造不存在的「原文引用」。
  const normalizedSource = sourceText.replace(/\s+/g, "");
  const rawQuotes = asStringArray(o.evidence_quotes, 3);
  const evidence = rawQuotes.filter((q) =>
    normalizedSource.includes(q.replace(/\s+/g, ""))
  );
  if (rawQuotes.length > evidence.length) {
    warnings.push(
      `丢弃 ${rawQuotes.length - evidence.length} 条非原文引用的依据`
    );
  }

  // 2) 风险等级与原因必须匹配：非低风险至少要有一条原因
  let reasons = asStringArray(o.risk_reasons, 3);
  let level = riskLevel as RiskLevel;
  if (level !== "low" && reasons.length === 0) {
    warnings.push("非低风险但未给出原因，已降级为 low");
    level = "low";
  }
  if (level === "low") reasons = reasons.slice(0, 1);

  // 3) 高风险至少两条原因，不足则降级为 medium
  if ((level === "high" || level === "critical") && reasons.length < 2) {
    warnings.push("高风险但依据不足两条，已降级为 medium 并标记人工确认");
    level = "medium";
  }

  // 4) 正面/中性却被判高风险，必须有原因，否则降级
  if (sentiment !== "negative" && (level === "high" || level === "critical")) {
    if (reasons.length < 2) {
      warnings.push("非负面文本被判高风险且依据不足，已降级为 medium");
      level = "medium";
    }
  }

  const confidence = clamp01(o.sentiment_confidence, 0.6);
  const topicConfidence = clamp01(o.topic_confidence, confidence);

  // 5) 置信度低或引用被丢弃过多，强制进入人工确认
  let needReview = o.need_human_review === true;
  if (confidence < 0.6) needReview = true;
  if (evidence.length < rawQuotes.length) needReview = true;
  if (level === "critical") needReview = true;

  const value: AnalysisResult = {
    sentiment,
    sentiment_confidence: confidence,
    topic: topic as Topic,
    topic_confidence: topicConfidence,
    summary: String(o.summary ?? "").trim().slice(0, 80) || sourceText.slice(0, 40),
    keywords: asStringArray(o.keywords, 6),
    opinion: String(o.opinion ?? "").trim().slice(0, 60),
    risk_level: level,
    risk_reasons: reasons,
    evidence_quotes: evidence,
    need_human_review: needReview,
    engine,
    promptVersion: PROMPT_VERSION,
    analyzedAt: new Date().toISOString(),
  };

  if (value.keywords.length === 0) {
    warnings.push("关键词为空");
    value.keywords = ["未提取"];
  }

  return { ok: true, value, warnings, errors };
}

/** 生成给模型的重试提示：把校验错误原样回传，比让模型猜要有效得多 */
export function buildRepairHint(errors: string[], warnings: string[]): string {
  const lines = [
    "上一次输出未通过结构校验，请修正后只返回 JSON 对象，不要任何解释文字。",
    ...errors.map((e) => `- 错误：${e}`),
    ...warnings.map((w) => `- 警告：${w}`),
  ];
  return lines.join("\n");
}
