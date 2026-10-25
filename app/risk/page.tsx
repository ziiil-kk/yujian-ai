"use client";

import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { useStore } from "@/lib/store";
import { Banner, BarList, Empty, Note, Panel, RiskTag, fmtTime } from "@/components/ui";
import { RISK_LABEL } from "@/lib/types";

export default function RiskPage() {
  const store = useStore();
  const router = useRouter();
  const { risk, items, results, stats } = store;
  const [note, setNote] = useState("");

  if (items.length === 0 || Object.keys(results).length === 0) {
    return (
      <Empty
        title="还没有风险研判结果"
        desc="风险研判需要基于完整的分析结果。请先载入数据并完成分析。"
        action={
          <button className="btn primary" onClick={() => store.loadSnapshot()}>
            载入示例快照
          </button>
        }
      />
    );
  }

  if (!risk) {
    return (
      <Empty
        title="尚未生成风险研判"
        desc="系统会先用确定性规则算出五个维度的指标，再由模型把数字翻译成判断与表述。"
        action={
          <button className="btn primary" onClick={() => store.recompute()}>
            生成风险研判
          </button>
        }
      />
    );
  }

  const dimColor = (score: number) =>
    score >= 75 ? "var(--r-crit)" : score >= 55 ? "var(--r-high)" : score >= 32 ? "var(--r-med)" : "var(--r-low)";

  const watch = risk.watchlistItemIds
    .map((id) => items.find((i) => i.id === id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const review = risk.humanReviewItemIds
    .map((id) => items.find((i) => i.id === id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return (
    <div className="stack">
      <div className="risk-head">
        <div className="lvl">
          <div className="big">{RISK_LABEL[risk.overallLevel]}</div>
          <div>
            <div className="tiny muted" style={{ marginBottom: 4 }}>
              综合风险等级 · 由 {risk.factors.length} 项维度加权得出 · 引擎：{risk.engine}
            </div>
            <div className="lead">{risk.headline}</div>
          </div>
        </div>
      </div>

      <Banner kind="info">
        这一页的设计目标是回答三个问题：风险有多大、为什么、该盯哪几条。
        每一条判断依据都必须带数据支撑，并且可以点进去看到具体是哪些文本 —— 只有结论没有理由的风险等级，实际工作中没人敢用。
      </Banner>

      <div className="grid g32">
        <Panel title="风险维度" sub="0–100 分" right="由规则算出，不是模型主观打分">
          <BarList
            rows={risk.factors.map((f) => ({
              label: f.dimension,
              value: f.score,
              color: dimColor(f.score),
            }))}
            max={100}
          />
          <Note>
            维度分由确定性规则计算：情绪占比、观点集中度、热度增速、诉求词命中率、敏感议题匹配。
            模型只负责把这些数字翻译成判断与话术，因此同一批数据重复研判的结果是稳定的。
          </Note>
        </Panel>

        <Panel title="判断依据" sub={`${risk.factors.length} 条 · 每条可下钻`}>
          {risk.factors.map((f, i) => (
            <div className="reason" key={`${f.dimension}-${i}`}>
              <span className="n">{i + 1}</span>
              <div>
                <div className="rt">
                  <b>{f.dimension}</b>：{f.conclusion}
                </div>
                <div className="ev">
                  {f.evidence}
                  {f.itemIds.length > 0 ? (
                    <>
                      {" · "}
                      <button
                        className="link"
                        onClick={() => router.push(`/analysis?item=${f.itemIds[0]}`)}
                      >
                        查看相关 {f.itemIds.length} 条
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </Panel>
      </div>

      <div className="grid g2">
        <Panel title="需关注文本" sub={`${watch.length} 条`} right="按风险等级排序">
          {watch.length === 0 ? (
            <Note>当前没有高风险条目。</Note>
          ) : (
            <div className="list">
              {watch.map((it) => {
                const r = results[it.id]!;
                return (
                  <div
                    className="item"
                    key={it.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => router.push(`/analysis?item=${it.id}`)}
                  >
                    <div className="t">{it.title}</div>
                    <div className="m">
                      <RiskTag value={r.risk_level} />
                      <span>
                        {it.source} · {fmtTime(it.publishedAt)}
                      </span>
                    </div>
                    {r.risk_reasons.length > 0 ? (
                      <div className="ev" style={{ marginTop: 6 }}>
                        触发原因：{r.risk_reasons.join("；")}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <div className="stack">
          <Panel title="待人工确认" sub={`${review.length} 条`} right="置信度偏低或涉及具体对象">
            {review.length === 0 ? (
              <Note>没有需要人工确认的条目。</Note>
            ) : (
              <div className="list">
                {review.slice(0, 6).map((it) => {
                  const r = results[it.id]!;
                  return (
                    <div
                      className="item"
                      key={it.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => router.push(`/analysis?item=${it.id}`)}
                    >
                      <div className="t" style={{ fontSize: 12 }}>
                        {it.title}
                      </div>
                      <div className="m">
                        <span className="num">置信度 {r.sentiment_confidence.toFixed(2)}</span>
                        <RiskTag value={r.risk_level} />
                        <span className="link">前往复核</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <Note>
              风险等级为高及以上的结论、置信度低于 0.6 的判断、以及涉及具体企业或个人的负面表达，
              都建议人工确认后再对外使用。这个清单是流程的一部分，不是一句说明。
            </Note>
          </Panel>

          <Panel title="人工确认" sub="留痕">
            {risk.confirmed ? (
              <Banner kind="info">
                已确认：{risk.confirmNote || "无备注"}。
                <br />
                确认时间：{fmtTime(risk.generatedAt)}
              </Banner>
            ) : (
              <>
                <div className="field">
                  <label>确认备注（可选）</label>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="例如：已与业务确认，重点关注就业相关表述"
                  />
                </div>
                <button className="btn primary block" onClick={() => store.confirmRisk(note)}>
                  我确认以上判断
                </button>
              </>
            )}
          </Panel>
        </div>
      </div>

      {stats && stats.timeUnknown > 0 ? (
        <Note>
          提示：有 {stats.timeUnknown} 条数据的时间无法从源获取，已用采集时间兜底，且未计入趋势统计，
          避免影响趋势判断。
        </Note>
      ) : null}
    </div>
  );
}
