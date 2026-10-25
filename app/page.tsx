"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useStore } from "@/lib/store";
import { DonutChart, TrendChart } from "@/components/charts";
import {
  BarList, ChipList, Empty, Note, Panel, RiskTag, SentimentTag, StatCard, fmtTime,
} from "@/components/ui";
import { RISK_LABEL, SENTIMENT_LABEL, type Sentiment } from "@/lib/types";

export default function DashboardPage() {
  const store = useStore();
  const router = useRouter();
  const { stats, items, cleaning, risk } = store;
  const analyzed = Object.keys(store.results).length;

  if (items.length === 0) {
    return (
      <Empty
        title="还没有数据"
        desc="可以先载入一份内置的 AI 行业舆情快照，直接体验完整流程；也可以到「数据导入」页订阅关键词、粘贴文本或上传 CSV。"
        action={
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={() => store.loadSnapshot()}>
              载入示例快照
            </button>
            <Link className="btn" href="/input">
              去数据导入
            </Link>
          </div>
        }
      />
    );
  }

  if (!stats || analyzed === 0) {
    return (
      <Empty
        title="数据已就绪，等待分析"
        desc={`当前数据池有 ${items.length} 条舆情。点击开始分析后，这里会展示情绪分布、风险等级、热门主题与趋势。`}
        action={
          <button
            className="btn primary"
            onClick={async () => {
              await store.runAnalysis();
              await store.recompute();
            }}
          >
            开始 AI 分析
          </button>
        }
      />
    );
  }

  const neg = stats.sentiment.find((s) => s.key === "negative")!;
  const pos = stats.sentiment.find((s) => s.key === "positive")!;
  const neu = stats.sentiment.find((s) => s.key === "neutral")!;

  const highRisk = items
    .filter((it) => {
      const r = store.results[it.id];
      return r?.risk_level === "critical" || r?.risk_level === "high";
    })
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
      return (
        rank[store.results[a.id]!.risk_level] - rank[store.results[b.id]!.risk_level]
      );
    })
    .slice(0, 3);

  const colorOf = (k: Sentiment) =>
    k === "negative" ? "var(--neg)" : k === "positive" ? "var(--pos)" : "var(--neu)";

  return (
    <div className="stack">
      {cleaning ? (
        <div className="banner info">
          本次共抓取 {cleaning.fetched} 条，去重 {cleaning.duplicated} 条，过滤噪声 {cleaning.noisy} 条，
          最终入池 <b>{cleaning.kept}</b> 条。原始条目已按 URL、标题指纹与内容指纹三级去重。
        </div>
      ) : null}

      <div className="cards">
        <StatCard label="舆情总量" value={stats.total} unit="条" detail={`去重后 · 覆盖 ${stats.sources.length} 个来源`} />
        <StatCard
          label="负面占比"
          value={(neg.ratio * 100).toFixed(1)}
          unit="%"
          tone="var(--neg)"
          detail={`${neg.count} 条 · 近 3 日 ${(stats.recentNegativeRatio * 100).toFixed(0)}%`}
        />
        <StatCard
          label="综合风险等级"
          value={risk ? RISK_LABEL[risk.overallLevel] : "—"}
          tone={risk?.overallLevel === "critical" ? "var(--r-crit)" : risk?.overallLevel === "high" ? "var(--r-high)" : undefined}
          detail={risk ? `${risk.factors.length} 项判断依据` : "尚未生成，去风险研判页"}
        />
        <StatCard
          label="待人工确认"
          value={stats.needReview}
          unit="条"
          detail={`已人工修正 ${stats.corrected} 条${stats.failed ? ` · 分析失败 ${stats.failed} 条` : ""}`}
        />
      </div>

      <div className="grid g23">
        <Panel title="情绪分布" sub={`共 ${stats.total} 条`}>
          <div className="row" style={{ gap: 22, alignItems: "center" }}>
            <div style={{ flex: "0 0 190px" }}>
              <DonutChart
                data={[
                  { name: "负面", value: neg.count, color: "#D33A32" },
                  { name: "中性", value: neu.count, color: "#8A93A5" },
                  { name: "正面", value: pos.count, color: "#1B8F53" },
                ]}
                centerValue={`${(neg.ratio * 100).toFixed(1)}%`}
                centerLabel="负面占比"
              />
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              {[neg, neu, pos].map((d) => (
                <div
                  key={d.key}
                  className="row"
                  style={{ justifyContent: "space-between", fontSize: 12, marginBottom: 12 }}
                >
                  <span className="muted row" style={{ gap: 7 }}>
                    <i className="dot" style={{ background: colorOf(d.key) }} />
                    {SENTIMENT_LABEL[d.key]}
                  </span>
                  <b className="num">{d.count}</b>
                </div>
              ))}
              <Note>情绪与风险是两个独立维度，负面不等于高风险。</Note>
            </div>
          </div>
        </Panel>

        <Panel title="风险等级分布" sub="四级">
          <BarList
            rows={stats.risk.map((r) => ({
              label: RISK_LABEL[r.key],
              value: r.count,
              color: `var(--r-${r.key === "medium" ? "med" : r.key === "critical" ? "crit" : r.key})`,
            }))}
          />
          <Note>风险等级由五个维度加权得出，具体依据见「风险研判」页。</Note>
        </Panel>
      </div>

      <div className="grid g2">
        <Panel title="热门主题" sub="Top 6" right="主题来自固定标签体系">
          <BarList rows={stats.topics.slice(0, 6).map((t) => ({ label: t.key, value: t.count }))} />
        </Panel>

        <Panel title="高频关键词" sub="Top 12 · 已排除停用词">
          <ChipList
            rows={stats.keywords}
            onPick={(term) => router.push(`/analysis?q=${encodeURIComponent(term)}`)}
          />
          <Note>这里用频次列表而不是词云：词云无法比较频次，也无法点击下钻。</Note>
        </Panel>
      </div>

      <div className="grid g32">
        <Panel title="高风险样本" sub="Top 3" right="按风险等级排序">
          {highRisk.length === 0 ? (
            <Note>当前没有高风险条目。</Note>
          ) : (
            <div className="list">
              {highRisk.map((it) => {
                const r = store.results[it.id]!;
                return (
                  <div
                    className="item"
                    key={it.id}
                    onClick={() => router.push(`/analysis?item=${it.id}`)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="t">{it.title}</div>
                    <div className="m">
                      <RiskTag value={r.risk_level} />
                      <SentimentTag value={r.sentiment} />
                      <span>
                        {it.source} · {fmtTime(it.publishedAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="舆情趋势" sub="按天" right="可对比负面量">
          {stats.trend.length > 1 ? (
            <>
              <TrendChart
                dates={stats.trend.map((t) => t.label)}
                total={stats.trend.map((t) => t.total)}
                negative={stats.trend.map((t) => t.negative)}
              />
              <Note>{stats.trendNote}</Note>
            </>
          ) : (
            <Note>时间字段不足，无法绘制趋势。可能的原因是发布时间的格式无法解析。</Note>
          )}
        </Panel>
      </div>
    </div>
  );
}
