// 舆见 AI —— 领域数据模型
// 这一层是「AI 输出」与「前端渲染」之间的契约：所有模块只认这里的结构。

export type Sentiment = "positive" | "neutral" | "negative";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ItemStatus = "pending" | "analyzing" | "analyzed" | "failed";
export type SourceType = "keyword_feed" | "rss" | "snapshot" | "manual" | "csv";

export const TOPICS = [
  "技术进展",
  "产品发布",
  "商业化与融资",
  "政策与监管",
  "行业竞争",
  "社会影响与伦理",
  "用户反馈与体验",
  "其他",
] as const;
export type Topic = (typeof TOPICS)[number];

export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: "正面",
  neutral: "中性",
  negative: "负面",
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

export const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

/**
 * 抓取/导入进来的原始条目，尚未分析。
 * 字段全部可缺省 —— 原始数据本来就是不完整的，
 * 「补齐」是 ingest() 的职责，不是原始层的前提。
 */
export interface RawItem {
  title?: string;
  content?: string;
  source?: string;
  publishedAt?: string;
  url?: string;
}

/**
 * 归一化后的条目：标题与来源已补齐，可以进入清洗流程。
 * RawItem 的 title/source 是可选的（用户粘贴或 CSV 可能缺字段），
 * 补齐之后用这个类型表达「字段已就绪」，避免在调用处反复做非空断言。
 */
export interface NormalizedItem extends RawItem {
  title: string;
  source: string;
}

/** 进入数据池的舆情条目 */
export interface OpinionItem {
  id: string;
  title: string;
  content: string;
  source: string;
  sourceType: SourceType;
  url?: string;
  publishedAt: string;
  collectedAt: string;
  /** 发布时间是否为兜底值（源未提供或格式无法解析） */
  timeKnown: boolean;
  dedupHash: string;
  status: ItemStatus;
  /** 分析失败原因，便于用户单独重试 */
  error?: string;
}

/** AI 单条分析结果 —— 与 lib/schema.ts 中的 JSON Schema 一一对应 */
export interface AnalysisResult {
  sentiment: Sentiment;
  sentiment_confidence: number;
  topic: Topic;
  topic_confidence: number;
  summary: string;
  keywords: string[];
  opinion: string;
  risk_level: RiskLevel;
  risk_reasons: string[];
  evidence_quotes: string[];
  need_human_review: boolean;
  /** 该条分析由谁产出：真实模型标识或 mock 标识 */
  engine: string;
  promptVersion: string;
  analyzedAt: string;
}

/** 人工修正记录 —— 既是产品功能，也是 Prompt 迭代的评测数据来源 */
export interface Correction {
  id: string;
  itemId: string;
  field: "sentiment" | "topic" | "risk_level" | "opinion";
  originalValue: string;
  correctedValue: string;
  correctedAt: string;
}

export interface Cluster {
  id: string;
  title: string;
  description: string;
  itemIds: string[];
  itemCount: number;
  sentimentDistribution: Record<Sentiment, number>;
  representativeItemIds: string[];
}

export interface RiskFactor {
  dimension: string;
  conclusion: string;
  evidence: string;
  score: number;
  itemIds: string[];
}

export interface RiskAssessment {
  overallLevel: RiskLevel;
  headline: string;
  factors: RiskFactor[];
  watchlistItemIds: string[];
  humanReviewItemIds: string[];
  generatedAt: string;
  confirmed: boolean;
  confirmNote?: string;
  engine: string;
}

export interface ReportSection {
  key: string;
  title: string;
  content: string;
  citations: string[];
  /** 该段是否由模型自由表述（需人工确认） */
  generated: boolean;
}

export interface Report {
  sections: ReportSection[];
  generatedAt: string;
  includedCorrections: number;
  engine: string;
}

export interface DataSource {
  id: string;
  name: string;
  type: SourceType;
  url?: string;
  keyword?: string;
  status: "ok" | "partial" | "error" | "unverified";
  lastFetchAt?: string;
  lastItemCount?: number;
  note?: string;
}

export interface DatasetMeta {
  name: string;
  itemCount: number;
  rangeStart: string;
  rangeEnd: string;
  sources: number;
  mode: "live" | "mock";
  promptVersion: string;
}

/** 采集清洗的统计，用于把「数据怎么来的」透明化 */
export interface CleaningStats {
  fetched: number;
  duplicated: number;
  noisy: number;
  kept: number;
}
