// 舆见 AI —— 端到端验证脚本
//
// 不依赖浏览器与服务端口：直接把核心分析链路跑一遍。
// 覆盖 清洗 → 批量分析 → Schema 校验 → 确定性 → 指标口径 → 聚类 → 风险研判 → 简报。
//
// 运行： npm test

const { SNAPSHOT_RAW, SNAPSHOT_NAME } = require("../work/tsout/data/snapshot.js");
const { ingest } = require("../work/tsout/lib/clean.js");
const { analyzeBatch, analyzeItem, buildClusters, assessRisk, buildReport } = require("../work/tsout/lib/analysis.js");
const { computeStats } = require("../work/tsout/lib/stats.js");
const { validateAnalysis } = require("../work/tsout/lib/schema.js");

const fails = [];
function check(name, cond, extra = "") {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${extra ? "  → " + extra : ""}`);
  if (!cond) fails.push(name);
}

(async () => {
  console.log("\n=== 1. 数据接入与清洗 ===");
  const t0 = Date.now();
  const ing = ingest(SNAPSHOT_RAW, "snapshot", SNAPSHOT_NAME);
  const { items, stats: clean, dropped } = ing;
  console.log(`  原始 ${clean.fetched} 条 → 去重 ${clean.duplicated} → 噪声 ${clean.noisy} → 入池 ${clean.kept} 条`);
  check("入池条数 > 0", items.length > 0, `${items.length} 条`);
  check("每条都有 id / 标题 / 正文 / 来源", items.every(i => i.id && i.title && i.content && i.source));
  check("时间字段已标准化且标记是否已知", items.every(i => !!i.publishedAt && typeof i.timeKnown === "boolean"));
  check("去重指纹唯一", new Set(items.map(i => i.dedupHash)).size === items.length);

  console.log("\n=== 2. 批量 AI 分析 ===");
  const t1 = Date.now();
  const { results, failed } = await analyzeBatch(items, 8);
  console.log(`  分析完成 ${results.size} 条，失败 ${failed.length} 条，耗时 ${Date.now() - t1} ms`);
  check("全部条目分析成功", failed.length === 0 && results.size === items.length);

  console.log("\n=== 3. JSON Schema 校验 ===");
  let schemaOk = 0, schemaBad = [];
  for (const it of items) {
    const v = validateAnalysis(results.get(it.id), it.content, "mock");
    if (v.ok) schemaOk++; else schemaBad.push({ id: it.id, err: v.errors });
  }
  check("所有结果通过 Schema 校验", schemaBad.length === 0, `${schemaOk}/${items.length} 通过`);
  if (schemaBad.length) console.log("   ", JSON.stringify(schemaBad.slice(0, 3), null, 2));

  const all = [...results.values()];
  check("情绪取值合法", all.every(r => ["positive","neutral","negative"].includes(r.sentiment)));
  check("风险等级取值合法", all.every(r => ["low","medium","high","critical"].includes(r.risk_level)));
  check("非低风险必须给出原因", all.every(r => r.risk_level === "low" || (r.risk_reasons && r.risk_reasons.length >= 1)));
  const byId = new Map(items.map(i => [i.id, i]));
  const quoteOffenders = [];
  for (const it of items) {
    const r = results.get(it.id);
    const hay = `${it.title}\n${it.content}`.replace(/\s+/g, "");
    for (const q of (r.evidence_quotes || [])) {
      const needle = String(q).replace(/\s+/g, "");
      if (needle && !hay.includes(needle)) quoteOffenders.push({ id: it.id, quote: q });
    }
  }
  check("原文依据必须是原文子串（防编造）", quoteOffenders.length === 0,
    quoteOffenders.length ? `越界 ${quoteOffenders.length} 处，例如「${quoteOffenders[0].quote}」` : "全部可回原文核对");

  const confOk = all.every(r => typeof r.sentiment_confidence === "number" && r.sentiment_confidence >= 0 && r.sentiment_confidence <= 1
    && typeof r.topic_confidence === "number" && r.topic_confidence >= 0 && r.topic_confidence <= 1);
  check("置信度在 0–1 之间", confOk);

  const reviewed = all.filter(r => r.need_human_review).length;
  check("低置信度条目被标记为待人工确认", all.every(r => (r.sentiment_confidence >= 0.6) || r.need_human_review === true),
    `待确认 ${reviewed} 条`);

  console.log("\n=== 4. 确定性校验（同输入必须同输出）===");
  const probe = items[0];
  const a = await analyzeItem(probe), b = await analyzeItem(probe);
  check("重复分析结果完全一致", JSON.stringify(a) === JSON.stringify(b));

  console.log("\n=== 5. 统计指标 ===");
  const stats = computeStats(items, results, new Set());
  const neg = stats.sentiment.find(s=>s.key==="negative");
  console.log(`  总量 ${stats.total} · 负面 ${neg.count} (${(neg.ratio*100).toFixed(1)}%) · 近3日负面占比 ${(stats.recentNegativeRatio*100).toFixed(1)}%`);
  console.log(`  主题 Top3: ${stats.topics.slice(0,3).map(t=>`${t.key} ${t.count}`).join(" / ")}`);
  console.log(`  关键词 Top5: ${stats.keywords.slice(0,5).map(k=>`${k.term} ${k.count}`).join(" / ")}`);
  console.log(`  趋势 ${stats.trend.length} 天 · 来源 ${stats.sources.length} 个 · 待人工确认 ${stats.needReview} 条 · 平均置信度 ${stats.avgConfidence}`);
  console.log(`  趋势说明: ${stats.trendNote}`);
  check("情绪分布计数之和等于总量", stats.sentiment.reduce((s,d)=>s+d.count,0) === stats.total);
  check("风险分布计数之和等于总量", stats.risk.reduce((s,d)=>s+d.count,0) === stats.total);
  check("主题分布计数之和等于总量", stats.topics.reduce((s,d)=>s+d.count,0) === stats.total);
  check("负面占比与计数一致", Math.abs(neg.ratio - neg.count / stats.total) < 1e-9);
  check("每条情绪的占比都合法", stats.sentiment.every(d => d.ratio >= 0 && d.ratio <= 1));
  check("关键词不含空值", stats.keywords.every(k => typeof k.term === "string" && k.term.length > 0));
  check("趋势按天且总量相符", stats.trend.length > 0 && stats.trend.reduce((s,t)=>s+t.total,0) === stats.total);

  console.log("\n=== 6. 观点聚类 ===");
  const clusters = await buildClusters(items, results);
  console.log(`  聚类 ${clusters.clusters.length} 个 · ${clusters.note || ""}`);
  clusters.clusters.forEach(c => console.log(`    · ${c.title} — ${c.itemCount} 条`));
  check("聚类数量在 1–6 之间", clusters.clusters.length >= 1 && clusters.clusters.length <= 6);
  check("聚类样本数不超过总量", clusters.clusters.reduce((s,c)=>s+c.itemCount,0) <= items.length);
  check("每个观点都有描述", clusters.clusters.every(c => (c.description||"").trim().length > 0));
  check("每个观点有代表文本且指向真实样本",
    clusters.clusters.every(c => (c.representativeItemIds||[]).length > 0 &&
      c.representativeItemIds.every(id => items.some(i => i.id === id))));
  check("观点的 itemIds 都指向真实样本",
    clusters.clusters.every(c => c.itemIds.every(id => items.some(i => i.id === id))));
  check("观点样本数与 itemIds 一致", clusters.clusters.every(c => c.itemCount === c.itemIds.length));

  console.log("\n=== 7. 风险研判 ===");
  const risk = await assessRisk(items, results, clusters.clusters, stats, []);
  const ra = risk.assessment;
  console.log(`  综合等级: ${ra.overallLevel} (加权分 ${risk.weightedScore})`);
  console.log(`  结论: ${ra.headline}`);
  console.log(`  判断依据 ${ra.factors.length} 条:`);
  ra.factors.forEach(f => console.log(`    · [${f.dimension}] ${f.conclusion}\n        数据支撑: ${f.evidence}`));
  check("综合等级合法", ["low","medium","high","critical"].includes(ra.overallLevel));
  check("判断依据至少 3 条（不能只给结论）", ra.factors.length >= 3, `${ra.factors.length} 条`);
  check("每条依据都有维度与结论", ra.factors.every(f => f.dimension && f.conclusion));
  check("每条依据都带数据支撑", ra.factors.every(f => typeof f.evidence === "string" && f.evidence.trim().length > 0));
  check("依据里含具体数字（不是套话）", ra.factors.every(f => /\d/.test(f.evidence)));
  check("依据可下钻到真实样本", ra.factors.every(f => (f.itemIds||[]).every(id => items.some(i => i.id === id))));
  check("有需关注文本清单", Array.isArray(ra.watchlistItemIds) && ra.watchlistItemIds.length > 0, `${ra.watchlistItemIds.length} 条`);
  check("关注清单指向真实样本", ra.watchlistItemIds.every(id => items.some(i => i.id === id)));
  check("低置信度条目进入待人工确认", ra.humanReviewItemIds.every(id => items.some(i => i.id === id)));

  console.log("\n=== 8. 简报生成 ===");
  const dates = items.map(i => i.publishedAt).sort();
  const report = await buildReport(stats, clusters.clusters, ra, [], { start: dates[0], end: dates[dates.length-1] });
  const secs = report.sections || [];
  console.log(`  段落数 ${secs.length}`);
  secs.forEach(s => console.log(`    · ${s.title} (${(s.content||"").length} 字)${s.citations?.length ? " 引用:"+s.citations.length : ""}`));
  check("简报为七段式", secs.length === 7, `${secs.length} 段`);
  check("每段都有内容", secs.every(s => (s.content||"").trim().length > 0));
  check("事实性段落带引用", secs.slice(0,6).every(s => (s.citations||[]).length > 0));

  console.log("\n=== 结果 ===");
  console.log(fails.length === 0
    ? `全部通过 ✓  总耗时 ${Date.now() - t0} ms`
    : `失败 ${fails.length} 项: ${fails.join(" / ")}`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });

function it_id(r){ return r.itemId; }
