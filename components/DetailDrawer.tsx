"use client";

// 舆见 AI —— 样本详情抽屉
// 这是全产品的信任支点：用户看到任何一个结论，都必须能一键回到原文和判断依据。
// 所以抽屉里放三样东西：原文、AI 的每一项判断、以及「我不同意」的入口。

import React from "react";
import { useStore } from "@/lib/store";
import { TOPICS, type Correction } from "@/lib/types";
import { RiskTag, SentimentTag, fmtTime, Note } from "./ui";

export function DetailDrawer({ itemId }: { itemId: string }) {
  const store = useStore();
  const item = store.items.find((i) => i.id === itemId);
  const result = store.results[itemId];

  if (!item) return null;

  if (!result) {
    return (
      <div className="drawer">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h4>样本详情</h4>
          <span className="sub">{item.source}</span>
        </div>
        <div className="quote">{item.content}</div>
        <Note>
          {item.status === "failed"
            ? "这条分析失败，可以单独重试，不影响其他条目。"
            : "这条尚未分析。"}
        </Note>
        <button className="btn" onClick={() => store.reanalyze(item.id)}>
          重新分析这一条
        </button>
      </div>
    );
  }

  const correctionOf = (f: Correction["field"]) =>
    store.corrections.filter((c) => c.itemId === itemId && c.field === f).slice(-1)[0];

  return (
    <div className="drawer">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h4>样本详情</h4>
        <span className="sub">
          {item.source} · {fmtTime(item.publishedAt)}
          {item.timeKnown ? "" : "（时间未知，已用采集时间兜底）"}
        </span>
      </div>

      <div className="quote">{item.content}</div>

      <div className="kv">
        <span className="k">情绪</span>
        <span className="v">
          <SentimentTag value={result.sentiment} />{" "}
          <span className="num muted" style={{ fontSize: 11 }}>
            置信度 {result.sentiment_confidence.toFixed(2)}
          </span>
        </span>

        <span className="k">主题</span>
        <span className="v">
          {result.topic}{" "}
          <span className="num muted" style={{ fontSize: 11 }}>
            置信度 {result.topic_confidence.toFixed(2)}
          </span>
        </span>

        <span className="k">核心观点</span>
        <span className="v">{result.opinion}</span>

        <span className="k">关键词</span>
        <span className="v">{result.keywords.join(" / ") || "-"}</span>

        <span className="k">风险等级</span>
        <span className="v">
          <RiskTag value={result.risk_level} />
        </span>
      </div>

      {result.risk_reasons.length > 0 ? (
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            风险原因（每条都对应原文中的具体表达）
          </div>
          {result.risk_reasons.map((r, i) => (
            <div className="reason" key={i}>
              <span className="n">{i + 1}</span>
              <div>
                <div className="rt">{r}</div>
                {result.evidence_quotes[i] ? (
                  <div className="ev">依据原文：{result.evidence_quotes[i]}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {result.evidence_quotes.length > result.risk_reasons.length ? (
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            其他原文依据
          </div>
          {result.evidence_quotes.slice(result.risk_reasons.length).map((q, i) => (
            <div className="ev" key={i} style={{ marginBottom: 4 }}>
              {q}
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <div className="tiny muted" style={{ marginBottom: 6 }}>
          人工修正 —— AI 给建议，最终判断由你决定
        </div>
        <div className="field">
          <label>情绪</label>
          <select
            value={result.sentiment}
            onChange={(e) =>
              store.correct(itemId, "sentiment", e.target.value, result.sentiment)
            }
          >
            <option value="positive">正面</option>
            <option value="neutral">中性</option>
            <option value="negative">负面</option>
          </select>
        </div>
        <div className="field">
          <label>主题</label>
          <select value={result.topic} onChange={(e) => store.correct(itemId, "topic", e.target.value, result.topic)}>
            {TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>风险等级</label>
          <select
            value={result.risk_level}
            onChange={(e) => store.correct(itemId, "risk_level", e.target.value, result.risk_level)}
          >
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="critical">严重</option>
          </select>
        </div>
      </div>

      {(correctionOf("sentiment") || correctionOf("topic") || correctionOf("risk_level")) ? (
        <div className="banner info" style={{ marginBottom: 0 }}>
          已有人工修正：
          {(["sentiment", "topic", "risk_level"] as const).map((f) => {
            const c = correctionOf(f);
            if (!c) return null;
            return (
              <div key={f}>
                {f}：{c.originalValue} → <b>{c.correctedValue}</b>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="note">
        判断由 {result.engine} 产出 · Prompt {result.promptVersion}
        {item.url ? (
          <>
            {" · "}
            <a className="link" href={item.url} target="_blank" rel="noreferrer">
              查看原文链接
            </a>
          </>
        ) : null}
      </div>

      <button className="btn block" onClick={() => store.reanalyze(item.id)}>
        重新分析这一条
      </button>
    </div>
  );
}
