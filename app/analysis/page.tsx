"use client";

import { useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { DetailDrawer } from "@/components/DetailDrawer";
import { Banner, Empty, Note, Panel, RiskTag, SentimentTag, fmtTime } from "@/components/ui";
import type { RiskLevel, Sentiment } from "@/lib/types";
import { RISK_LABEL, SENTIMENT_LABEL } from "@/lib/types";

type View = "list" | "cluster";

function AnalysisInner() {
  const params = useSearchParams();
  const store = useStore();
  const { items, results, clusters, clusterNote } = store;

  const [view, setView] = useState<View>("list");
  const [sentiment, setSentiment] = useState<Sentiment | "all">("all");
  const [risk, setRisk] = useState<RiskLevel | "all" | "high+">("all");
  const [topic, setTopic] = useState<string>("all");
  const [keyword, setKeyword] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(params.get("item"));
  const [onlyReview, setOnlyReview] = useState(false);
  const [onlyCorrected, setOnlyCorrected] = useState(false);

  useEffect(() => {
    const q = params.get("q");
    if (q) setKeyword(q);
    const it = params.get("item");
    if (it) setSelected(it);
  }, [params]);

  const analyzed = items.filter((i) => results[i.id]);

  const filtered = useMemo(() => {
    const kw = query.trim();
    return analyzed
      .filter((it) => {
        const r = results[it.id]!;
        if (sentiment !== "all" && r.sentiment !== sentiment) return false;
        if (risk === "high+" && r.risk_level !== "high" && r.risk_level !== "critical") return false;
        if (risk !== "all" && risk !== "high+" && r.risk_level !== risk) return false;
        if (topic !== "all" && r.topic !== topic) return false;
        if (onlyReview && !r.need_human_review) return false;
        if (onlyCorrected && !store.correctedIds.has(it.id)) return false;
        if (keyword && !`${it.title} ${it.content} ${r.keywords.join(" ")}`.includes(keyword)) return false;
        if (kw && !`${it.title} ${it.content}`.includes(kw)) return false;
        return true;
      })
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  }, [analyzed, results, sentiment, risk, topic, onlyReview, onlyCorrected, keyword, query, store.correctedIds]);

  if (items.length === 0) {
    return (
      <Empty
        title="还没有可分析的数据"
        desc="先到「数据导入」页载入示例快照或导入自己的数据。"
        action={
          <button className="btn primary" onClick={() => store.loadSnapshot()}>
            载入示例快照
          </button>
        }
      />
    );
  }

  if (Object.keys(results).length === 0) {
    return <Empty title="尚未分析" desc="数据已导入，但还没有分析结果。点击分析后这里会展示每条舆情的结构化判断。" />;
  }

  const topics = [...new Set(analyzed.map((i) => results[i.id]!.topic))];

  return (
    <div className="stack">
      {store.engine === "mock" ? (
        <Banner kind="info">
          当前为模拟数据模式：判断由确定性规则引擎产出，同样输入永远得到同样输出，便于演示与复盘。
          配置模型密钥后会自动切换为真实模型，界面结构完全一致。
        </Banner>
      ) : null}

      <div className="filters">
        <button className={`filter ${view === "list" ? "on" : ""}`} onClick={() => setView("list")}>
          列表视图
        </button>
        <button className={`filter ${view === "cluster" ? "on" : ""}`} onClick={() => setView("cluster")}>
          观点聚类
        </button>
        <span style={{ width: 10 }} />
        <button className={`filter ${sentiment === "all" ? "on" : ""}`} onClick={() => setSentiment("all")}>
          全部 {analyzed.length}
        </button>
        {(["negative", "neutral", "positive"] as Sentiment[]).map((s) => (
          <button
            key={s}
            className={`filter ${sentiment === s ? "on" : ""}`}
            onClick={() => setSentiment(s)}
          >
            {SENTIMENT_LABEL[s]} {analyzed.filter((i) => results[i.id]!.sentiment === s).length}
          </button>
        ))}
        <span style={{ width: 10 }} />
        <button className={`filter ${risk === "high+" ? "on" : ""}`} onClick={() => setRisk("high+")}>
          风险 ≥ 高{" "}
          {analyzed.filter((i) => ["high", "critical"].includes(results[i.id]!.risk_level)).length}
        </button>
        <button className={`filter ${onlyReview ? "on" : ""}`} onClick={() => setOnlyReview((v) => !v)}>
          待人工确认
        </button>
        <button
          className={`filter ${onlyCorrected ? "on" : ""}`}
          onClick={() => setOnlyCorrected((v) => !v)}
        >
          已修正
        </button>
        <select
          className="filter"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          style={{ paddingRight: 8 }}
        >
          <option value="all">全部主题</option>
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          className="filter"
          style={{ minWidth: 190 }}
          placeholder="搜索标题或正文…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {Object.keys(results).length > 0 && store.clusters.length === 0 ? (
          <button className="filter" onClick={() => store.recompute()}>
            重算结论
          </button>
        ) : null}
      </div>

      {keyword ? (
        <Banner kind="info">
          正在按关键词「{keyword}」筛选，
          <button className="link" onClick={() => setKeyword("")}>
            清除筛选
          </button>
        </Banner>
      ) : null}

      {view === "list" ? (
        <div className="grid g23">
          <Panel
            title="分析结果"
            sub={`${filtered.length} / ${analyzed.length} 条`}
            right="点击任意行查看原文与判断依据"
          >
            <div className="table-wrap table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>来源</th>
                    <th>摘要</th>
                    <th>主题</th>
                    <th>情绪</th>
                    <th>风险</th>
                    <th>置信度</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 300).map((it) => {
                    const r = results[it.id]!;
                    const corrected = store.correctedIds.has(it.id);
                    return (
                      <tr
                        key={it.id}
                        className={selected === it.id ? "sel" : ""}
                        onClick={() => setSelected(it.id)}
                      >
                        <td className="sm">
                          {fmtTime(it.publishedAt)}
                          {!it.timeKnown ? " ⚠" : ""}
                        </td>
                        <td className="sm">{it.source}</td>
                        <td>
                          {r.summary}
                          {corrected ? <span className="tag neu" style={{ marginLeft: 6 }}>已修正</span> : null}
                          {r.need_human_review ? (
                            <span className="tag r-medium" style={{ marginLeft: 6 }}>
                              待确认
                            </span>
                          ) : null}
                        </td>
                        <td className="sm">{r.topic}</td>
                        <td>
                          <SentimentTag value={r.sentiment} />
                        </td>
                        <td>
                          <RiskTag value={r.risk_level} />
                        </td>
                        <td className="sm num">{r.sentiment_confidence.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 ? <Note>没有符合条件的条目。</Note> : null}
            </div>
          </Panel>

          {selected ? (
            <DetailDrawer itemId={selected} />
          ) : (
            <Panel title="样本详情">
              <Note>
                点击左侧任意一行，这里会展示原文全文、AI 的每一项判断与判断理由，并提供人工修正入口。
                这是让用户敢用 AI 结论的关键：任何一个判断都能点回原文核对。
              </Note>
            </Panel>
          )}
        </div>
      ) : (
        <div className="stack">
          {clusterNote ? <Banner kind="warn">{clusterNote}</Banner> : null}
          {clusters.length === 0 ? (
            <Empty
              title="尚未生成观点聚类"
              desc="聚类需要先完成整体分析。点击下方按钮计算主要观点。"
              action={
                <button className="btn primary" onClick={() => store.recompute()}>
                  生成观点聚类
                </button>
              }
            />
          ) : (
            <>
              <div className="grid g3">
                {clusters.slice(0, 6).map((c) => (
                  <Panel key={c.id} title={c.title} sub={`${c.itemCount} 条`}>
                    <div className="tiny muted" style={{ lineHeight: 1.7, marginBottom: 10 }}>
                      {c.description}
                    </div>
                    <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                      <span className="tag neg">负面 {c.sentimentDistribution.negative}</span>
                      <span className="tag neu">中性 {c.sentimentDistribution.neutral}</span>
                      <span className="tag pos">正面 {c.sentimentDistribution.positive}</span>
                    </div>
                    <div className="list">
                      {c.representativeItemIds.slice(0, 2).map((id) => {
                        const it = items.find((x) => x.id === id);
                        if (!it) return null;
                        return (
                          <div
                            className="item"
                            key={id}
                            style={{ cursor: "pointer" }}
                            onClick={() => {
                              setView("list");
                              setSelected(id);
                            }}
                          >
                            <div className="t" style={{ fontSize: 12 }}>
                              {it.title}
                            </div>
                            <div className="m">{it.source}</div>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                ))}
              </div>
              <Note>
                聚类结果会随数据变化而调整，这是聚类算法的固有特性，产品选择把它说明白而不是隐藏。
                代表文本刻意来自不同来源，避免全部集中在同一家媒体形成以偏概全的印象。
              </Note>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<Note>加载中…</Note>}>
      <AnalysisInner />
    </Suspense>
  );
}
