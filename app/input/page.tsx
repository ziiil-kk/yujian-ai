"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { parseCsv, parsePasted } from "@/lib/clean";
import { Banner, BarList, Note, Panel, Spinner } from "@/components/ui";

type Tab = "source" | "paste" | "csv" | "snapshot";

interface PresetSource {
  id: string;
  name: string;
  type: string;
  channel?: string;
  url?: string;
  note: string;
}

export default function InputPage() {
  const store = useStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("source");
  const [sources, setSources] = useState<PresetSource[]>([]);
  const [sourceId, setSourceId] = useState("kw-bing");
  const [keyword, setKeyword] = useState("AI");
  const [limit, setLimit] = useState(50);
  const [preview, setPreview] = useState<{ title: string; source: string; publishedAt: string }[]>([]);
  const [fetchState, setFetchState] = useState<{ busy?: string; error?: string; info?: string }>({});
  const [pasted, setPasted] = useState("");
  const [csvName, setCsvName] = useState("");

  useEffect(() => {
    fetch("/api/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    })
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []))
      .catch(() => setSources([]));
  }, []);

  const current = sources.find((s) => s.id === sourceId);

  // 快照是否已载入：直接由 store 派生，避免再维护一份本地状态造成不一致
  const snapshotLoaded =
    store.items.length > 0 && Boolean(store.datasetName?.includes("快照"));

  async function callSource(action: "preview" | "fetch") {
    setFetchState({ busy: action === "preview" ? "正在试采集" : "正在采集" });
    setPreview([]);
    try {
      const res = await fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sourceId, keyword, limit }),
      });
      const data = await res.json();

      if (!data.ok) {
        setFetchState({
          error: `${data.sourceName ?? "该数据源"}采集失败：${data.error ?? "未知原因"}。可以换一个源，或直接使用示例快照继续演示。`,
        });
        return;
      }

      if (action === "preview") {
        setPreview(data.preview ?? []);
        setFetchState({ info: `试采集成功，共取到 ${data.total} 条，以下为前 5 条样本。确认质量后再正式写入数据池。` });
        return;
      }

      setFetchState({});
      await store.ingest(data.items, "keyword_feed", `${data.sourceName} · ${keyword}`);
      setFetchState({
        info: `已采集 ${data.stats?.kept ?? data.items.length} 条并写入数据池。`,
      });
    } catch (e) {
      setFetchState({ error: `采集请求失败：${e instanceof Error ? e.message : "未知错误"}` });
    }
  }

  return (
    <div className="stack">
      <div className="segmented">
        <button aria-selected={tab === "source"} onClick={() => setTab("source")}>
          数据源订阅
        </button>
        <button aria-selected={tab === "paste"} onClick={() => setTab("paste")}>
          粘贴文本
        </button>
        <button aria-selected={tab === "csv"} onClick={() => setTab("csv")}>
          上传 CSV
        </button>
        <button aria-selected={tab === "snapshot"} onClick={() => setTab("snapshot")}>
          示例快照
        </button>
      </div>

      {tab === "source" ? (
        <div className="grid g32">
          <Panel title="添加数据源" sub="关键词订阅" right="试采集不写入数据池">
            <div className="field">
              <label>数据源</label>
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} —— {s.note}
                  </option>
                ))}
              </select>
            </div>

            {current?.type === "keyword_feed" ? (
              <div className="field">
                <label>关键词</label>
                <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="例如：AI" />
              </div>
            ) : null}

            <div className="field">
              <label>条数上限（最大 200）</label>
              <input
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </div>

            <div className="row">
              <button className="btn" disabled={Boolean(fetchState.busy)} onClick={() => callSource("preview")}>
                试采集预览
              </button>
              <button
                className="btn primary"
                disabled={Boolean(fetchState.busy)}
                onClick={() => callSource("fetch")}
                style={{ flex: 1 }}
              >
                正式采集并写入
              </button>
            </div>

            {fetchState.busy ? (
              <Note>
                <Spinner /> {fetchState.busy}…
              </Note>
            ) : null}
            {fetchState.error ? (
              <div style={{ marginTop: 10 }}>
                <Banner kind="warn">{fetchState.error}</Banner>
              </div>
            ) : null}
            {fetchState.info ? (
              <div style={{ marginTop: 10 }}>
                <Banner kind="info">{fetchState.info}</Banner>
              </div>
            ) : null}

            {preview.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <div className="list">
                  {preview.map((p, i) => (
                    <div className="item" key={i}>
                      <div className="t">{p.title}</div>
                      <div className="m">{p.source}{p.publishedAt ? ` · ${p.publishedAt}` : ""}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <Note>
              服务端代理转发请求，避免浏览器的跨域限制。单条数据源失败不会影响其他源；全部失败时可用示例快照继续。
            </Note>
          </Panel>

          <div className="stack">
            <Panel title="采集与清洗结果" sub="数据是分析的前提，这一步必须透明">
              <BarList
                rows={
                  store.cleaning
                    ? [
                        { label: "原始抓取", value: store.cleaning.fetched },
                        { label: "重复剔除", value: store.cleaning.duplicated, color: "var(--r-med)" },
                        { label: "噪声过滤", value: store.cleaning.noisy, color: "var(--r-med)" },
                        { label: "最终入池", value: store.cleaning.kept, color: "var(--pos)" },
                      ]
                    : []
                }
              />
              {!store.cleaning ? <Note>还没有采集记录。</Note> : null}
              <Note>
                去重按 URL 精确匹配、标题指纹、内容指纹三级执行。同一篇稿子被多家媒体转载时，只保留其中最权威的一条。
              </Note>
            </Panel>

            <Panel title="下一步" sub="数据就绪后开始分析">
              <div className="tiny muted" style={{ lineHeight: 1.8 }}>
                当前数据池 {store.items.length} 条
                {store.cleaning?.duplicated ? `，已剔除 ${store.cleaning.duplicated} 条重复` : ""}。
                分析由规则引擎处理，无需密钥；配置模型密钥后会自动切换为真实模型。
              </div>
              <button
                className="btn primary block"
                style={{ marginTop: 12 }}
                disabled={store.items.length === 0 || Boolean(store.busy)}
                onClick={async () => {
                  await store.runAnalysis();
                  await store.recompute();
                  router.push("/analysis");
                }}
              >
                开始 AI 分析
              </button>
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === "paste" ? (
        <div className="grid g2">
          <Panel title="粘贴文本" sub="一行一条；也支持「来源|时间|正文」格式">
            <div className="field">
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={"财新|2026-09-22 09:14|某大模型被指生成虚假医疗建议，平台回应含糊\n澎湃新闻|2026-09-22 10:30|国产开源模型新增权重发布，推理成本下降"}
              />
            </div>
            <button
              className="btn primary block"
              disabled={!pasted.trim() || Boolean(store.busy)}
              onClick={() => store.ingest(parsePasted(pasted), "manual", "手动粘贴数据")}
            >
              导入并清洗
            </button>
          </Panel>

          <Panel title="导入说明">
            <div className="tiny muted" style={{ lineHeight: 1.9 }}>
              1. 一行一条，空行自动忽略；
              <br />
              2. 使用「来源|时间|正文」格式可以保留来源与时间，缺省时来源记为「未知」、时间用采集时间兜底并标记；
              <br />
              3. 正文过短、命中广告特征、重复的条目会被自动剔除，不会阻塞整批导入；
              <br />
              4. 时间无法解析时不会进入趋势统计，避免污染曲线。
            </div>
            <Note>导入后可在「分析结果」页逐条复核，AI 的判断都可以被人工修正。</Note>
          </Panel>
        </div>
      ) : null}

      {tab === "csv" ? (
        <div className="grid g2">
          <Panel title="上传 CSV" sub="表头：published_at, source, content, title, url">
            <div className="field">
              <label>选择文件</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setCsvName(f.name);
                  const text = await f.text();
                  const raw = parseCsv(text);
                  if (raw.length === 0) {
                    store.setMessage({ kind: "warn", text: "没有从文件中解析到有效行，请检查表头是否包含 content 列。" });
                    return;
                  }
                  await store.ingest(raw, "csv", f.name);
                }}
              />
            </div>
            {csvName ? <Note>已选择：{csvName}</Note> : null}
            <Note>
              该功能用于对接人工整理好的表格。真正常用的场景是：分析师把各平台内容整理成表格，
              再交给系统批量分析。
            </Note>
          </Panel>

          <Panel title="模板" sub="可直接复制这段作为表头">
            <div className="quote" style={{ fontSize: 12 }}>
              published_at,source,content,title,url
              <br />
              2026-09-22 09:14,财新,某大模型被指生成虚假医疗建议,
              <br />
              ...
            </div>
            <Note>其中 content 为必填，其余列缺失时会自动兜底并标记。</Note>
          </Panel>
        </div>
      ) : null}

      {tab === "snapshot" ? (
        <div className="grid g32">
          <Panel title="示例快照" sub="AI 行业舆情 · 离线可用" right="载入后自动清洗">
            <div className="tiny muted" style={{ lineHeight: 1.9, marginBottom: 12 }}>
              这份快照包含 70 条 AI 行业相关舆情，覆盖 7 天、8 个来源，并刻意混入了重复转载与广告噪声条目，
              用来展示去重的真实效果。它保证了在没有网络、接口失效或未配置模型密钥的情况下，
              整个产品依然可以完整演示。
            </div>

            <button
              className="btn primary block"
              disabled={Boolean(store.busy)}
              onClick={() => store.loadSnapshot()}
            >
              {store.busy === "正在清洗数据" ? "正在载入…" : "载入示例快照"}
            </button>

            {snapshotLoaded ? (
              <div style={{ marginTop: 12 }}>
                <Banner kind="ok">
                  已载入 {store.items.length} 条并完成清洗，可以在右侧点击「开始 AI 分析」。
                </Banner>
              </div>
            ) : null}

            <Note>
              演示一个依赖实时抓取的产品是有风险的：面试现场的网络、源站限流、接口变更都不受你控制。
              所以产品在设计上就要求「无网络也能跑通全流程」，并做了三级降级：单个源失败不影响其他源；
              全部源失败时提示并引导；快照保证兜底。
            </Note>
          </Panel>

          <div className="stack">
            <Panel title="采集与清洗结果" sub="数据是分析的前提，这一步必须透明">
              <BarList
                rows={
                  snapshotLoaded && store.cleaning
                    ? [
                        { label: "原始条目", value: store.cleaning.fetched },
                        { label: "重复剔除", value: store.cleaning.duplicated, color: "var(--r-med)" },
                        { label: "噪声过滤", value: store.cleaning.noisy, color: "var(--r-med)" },
                        { label: "最终入池", value: store.cleaning.kept, color: "var(--pos)" },
                      ]
                    : []
                }
              />
              {!snapshotLoaded ? <Note>还没有载入数据。</Note> : null}
              <Note>
                快照里刻意混入了 7 条转载与 2 条广告噪声，用来演示「去重 → 过滤」这一步不是装饰。
              </Note>
            </Panel>

            <Panel title="下一步" sub="数据就绪后开始分析">
              <div className="tiny muted" style={{ lineHeight: 1.8 }}>
                当前数据池 {store.items.length} 条
                {store.cleaning?.duplicated ? `，已剔除 ${store.cleaning.duplicated} 条重复` : ""}。
                分析由规则引擎处理，无需密钥；配置模型密钥后会自动切换为真实模型。
              </div>
              <button
                className="btn primary block"
                style={{ marginTop: 12 }}
                disabled={store.items.length === 0 || Boolean(store.busy)}
                onClick={async () => {
                  await store.runAnalysis();
                  await store.recompute();
                  router.push("/analysis");
                }}
              >
                开始 AI 分析
              </button>
            </Panel>
          </div>
        </div>
      ) : null}

    </div>
  );
}
