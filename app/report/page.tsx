"use client";

import React, { useState } from "react";
import { useStore } from "@/lib/store";
import { Banner, Empty, Note, Panel } from "@/components/ui";
import { RISK_LABEL } from "@/lib/types";

export default function ReportPage() {
  const store = useStore();
  const { report, stats, risk, items } = store;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sections, setSections] = useState(report?.sections ?? []);

  React.useEffect(() => {
    setSections(report?.sections ?? []);
  }, [report]);

  if (items.length === 0 || Object.keys(store.results).length === 0) {
    return (
      <Empty
        title="还没有可生成简报的数据"
        desc="简报基于完整的分析结果生成。请先载入数据并完成分析。"
        action={
          <button className="btn primary" onClick={() => store.loadSnapshot()}>
            载入示例快照
          </button>
        }
      />
    );
  }

  if (!stats || !risk) {
    return (
      <Empty
        title="请先生成风险研判"
        desc="简报的第六段来自风险研判结论，因此需要先完成研判。"
        action={
          <button className="btn primary" onClick={() => store.recompute()}>
            生成风险研判
          </button>
        }
      />
    );
  }

  const start = stats.trend[0]?.date ?? "-";
  const end = stats.trend[stats.trend.length - 1]?.date ?? "-";

  function toMarkdown(): string {
    const head = `# AI 行业舆情简报\n\n生成时间：${new Date().toLocaleString("zh-CN")}\n数据范围：${start} 至 ${end} · 样本 ${stats!.total} 条 · 含人工修正 ${report?.includedCorrections ?? 0} 处\n\n`;
    return (
      head +
      sections
        .map((s) => `## ${s.title}\n\n${s.content}${s.generated ? "\n\n> 本段由模型生成，需人工确认后使用。" : ""}`)
        .join("\n\n")
    );
  }

  function download() {
    const blob = new Blob([toMarkdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `舆情简报_${start}_${end}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack">
      <Panel>
        <div className="row between">
          <div>
            <div style={{ fontSize: 14, fontWeight: 640 }}>AI 行业舆情简报</div>
            <div className="tiny muted" style={{ marginTop: 5, lineHeight: 1.7 }}>
              数据范围 {start} 至 {end} · 样本 {stats.total} 条 · 风险等级 {RISK_LABEL[risk.overallLevel]} ·
              含人工修正 {report?.includedCorrections ?? 0} 处 · 生成引擎 {report?.engine ?? "—"}
            </div>
          </div>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(toMarkdown());
                store.setMessage({ kind: "ok", text: "简报已复制为 Markdown。" });
              }}
            >
              复制 Markdown
            </button>
            <button className="btn" onClick={download}>
              下载 .md
            </button>
            <button className="btn" onClick={() => window.print()}>
              打印 / 存为 PDF
            </button>
            <button className="btn primary" onClick={() => store.generateReport({ start, end })} disabled={Boolean(store.busy)}>
              重新生成
            </button>
          </div>
        </div>
      </Panel>

      {!report ? (
        <Empty
          title="尚未生成简报"
          desc="点击下方按钮，基于当前分析结果生成七段式舆情简报。事实性段落只做数据填充，不交给模型自由发挥。"
          action={
            <button className="btn primary" onClick={() => store.generateReport({ start, end })}>
              一键生成简报
            </button>
          }
        />
      ) : (
        <div className="grid g23">
          <Panel title="简报正文" sub="可逐段在线编辑">
            <div className="stack">
              {sections.map((s) => (
                <div className="report-sec" key={s.key}>
                  <div className="row between" style={{ alignItems: "baseline", marginBottom: 6 }}>
                    <h5 style={{ margin: 0 }}>{s.title}</h5>
                    <div className="row" style={{ gap: 8 }}>
                      {s.generated ? <span className="tag r-medium">模型生成 · 待人工确认</span> : null}
                      <button
                        className="link"
                        style={{ fontSize: 11.5 }}
                        onClick={() => {
                          setEditing(editing === s.key ? null : s.key);
                          setDraft(s.content);
                        }}
                      >
                        {editing === s.key ? "取消" : "编辑"}
                      </button>
                    </div>
                  </div>

                  {editing === s.key ? (
                    <>
                      <div className="field">
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          style={{ minHeight: 110 }}
                        />
                      </div>
                      <div className="row">
                        <button
                          className="btn primary"
                          onClick={() => {
                            setSections((prev) =>
                              prev.map((x) => (x.key === s.key ? { ...x, content: draft } : x))
                            );
                            setEditing(null);
                          }}
                        >
                          保存本段
                        </button>
                        <button className="btn" onClick={() => setEditing(null)}>
                          取消
                        </button>
                      </div>
                    </>
                  ) : (
                    <p>{s.content}</p>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          <div className="stack">
            <Panel title="引用来源" sub="每段结论可溯源">
              <div className="tiny" style={{ lineHeight: 1.9 }}>
                {sections.map((s) => (
                  <div key={s.key} style={{ padding: "6px 0", borderBottom: "1px dashed var(--border)" }}>
                    <b>{s.title}</b> →{" "}
                    {s.key === "overview"
                      ? `数据池 ${stats.total} 条 · ${stats.sources.length} 个来源`
                      : s.key === "sentiment"
                        ? "情绪分布统计"
                        : s.key === "trend"
                          ? "按天趋势"
                          : s.key === "risk"
                            ? `${risk.factors.length} 项维度 · ${risk.factors.length} 条依据`
                            : s.key === "advice"
                              ? "由模型生成，需人工确认"
                              : `聚类结果 ${store.clusters.length} 个`}
                  </div>
                ))}
              </div>
              <Note>
                简报里每个数字都能回溯到原始样本。这是它和「让 AI 随便写一段」最本质的区别。
              </Note>
            </Panel>

            <Panel title="生成规则">
              <div className="tiny muted" style={{ lineHeight: 1.9 }}>
                一至六段为事实性段落：由模板加数据填充生成，不交给模型自由发挥。
                <br />
                第七段「建议关注事项」是唯一允许模型表述的部分，并强制标注「待人工确认」。
                <br />
                如果前面有人工修正过判断，简报会基于修正后的结果重新生成，并在元信息里计入修正条数。
              </div>
            </Panel>

            <Panel title="导出说明">
              <div className="tiny muted" style={{ lineHeight: 1.9 }}>
                支持复制 Markdown、下载 .md 文件，以及通过浏览器打印为 PDF。
                作品的最终交付物通常需要进入 Word 或邮件，所以导出格式选择了最通用的两种。
              </div>
            </Panel>
          </div>
        </div>
      )}

      {report && report.includedCorrections > 0 ? (
        <Banner kind="info">
          本次简报包含 {report.includedCorrections} 处人工修正。这些修正记录同时可以作为评估 AI 标注质量的样本集，
          用于后续 Prompt 迭代 —— 这是把「人工复核」做成产品能力之后自然获得的副产品。
        </Banner>
      ) : null}
    </div>
  );
}
