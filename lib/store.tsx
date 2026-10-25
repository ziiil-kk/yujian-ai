"use client";

// 舆见 AI —— 客户端状态
// 用一个 Context 承载数据池、分析结果、人工修正、聚类、风险研判与简报。
// 没有引入状态管理库：这个产品的状态是一棵浅树，用 reducer 足够，
// 少一个依赖就少一处演示时可能出错的地方。

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type {
  AnalysisResult,
  CleaningStats,
  Cluster,
  Correction,
  OpinionItem,
  RawItem,
  Report,
  RiskAssessment,
  SourceType,
} from "./types";
import { SNAPSHOT_RAW } from "@/data/snapshot";
import { computeStats, type DatasetStats } from "./stats";

export type MessageKind = "info" | "warn" | "danger" | "ok";
export interface Message {
  kind: MessageKind;
  text: string;
}

interface State {
  items: OpinionItem[];
  results: Record<string, AnalysisResult>;
  corrections: Correction[];
  clusters: Cluster[];
  risk?: RiskAssessment;
  report?: Report;
  cleaning?: CleaningStats;
  engine: "mock" | "live";
  clusterNote?: string;
  busy?: string;
  progress?: { done: number; total: number };
  message?: Message;
  hydrated: boolean;
  datasetName: string;
}

type Action =
  | { type: "hydrate"; payload: Partial<State> }
  | { type: "setItems"; items: OpinionItem[]; cleaning?: CleaningStats; datasetName?: string; message?: Message }
  | { type: "busy"; label?: string; progress?: { done: number; total: number } }
  | { type: "analyzed"; results: Record<string, AnalysisResult>; failed: string[]; engine: "mock" | "live" }
  | { type: "clusters"; clusters: Cluster[]; note?: string }
  | { type: "risk"; risk: RiskAssessment }
  | { type: "report"; report: Report }
  | { type: "correct"; correction: Correction }
  | { type: "reanalyzed"; itemId: string; result: AnalysisResult }
  | { type: "message"; message?: Message }
  | { type: "reset" };

const initialState: State = {
  items: [],
  results: {},
  corrections: [],
  clusters: [],
  engine: "mock",
  hydrated: false,
  datasetName: "未命名数据集",
};

/**
 * 代表「一次异步操作已经结束」的 action。
 *
 * 忙碌状态原先是在每个分支里各写一遍清理，结果 setItems / clusters / risk / report
 * 全都漏了 —— 界面会一直卡在「正在清洗数据」，而且因为顶部按钮依赖 busy 做 disabled，
 * 漏清一个分支就等于把所有操作锁死。
 *
 * 所以改成在 reducer 外层统一收尾：新增 action 时只要判断它是否代表操作结束，
 * 不再依赖每个分支自己记得清理。
 */
const TERMINAL_ACTIONS: ReadonlySet<Action["type"]> = new Set<Action["type"]>([
  "hydrate",
  "setItems",
  "analyzed",
  "clusters",
  "risk",
  "report",
  "correct",
  "reanalyzed",
  "reset",
]);

function reducer(state: State, action: Action): State {
  const next = applyAction(state, action);
  if (!TERMINAL_ACTIONS.has(action.type)) return next;
  return { ...next, busy: undefined, progress: undefined };
}

function applyAction(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return { ...state, ...action.payload, hydrated: true };
    case "setItems":
      return {
        ...state,
        items: action.items,
        results: {},
        corrections: [],
        clusters: [],
        risk: undefined,
        report: undefined,
        cleaning: action.cleaning,
        datasetName: action.datasetName ?? state.datasetName,
        message: action.message,
      };
    case "busy":
      return { ...state, busy: action.label, progress: action.progress };
    case "analyzed": {
      const items = state.items.map((it) =>
        action.failed.includes(it.id) ? { ...it, status: "failed" as const, error: "分析失败" } : { ...it, status: "analyzed" as const }
      );
      return { ...state, items, results: action.results, engine: action.engine };
    }
    case "clusters":
      return { ...state, clusters: action.clusters, clusterNote: action.note };
    case "risk":
      return { ...state, risk: action.risk };
    case "report":
      return { ...state, report: action.report };
    case "correct": {
      const results = { ...state.results };
      const cur = results[action.correction.itemId];
      if (cur) {
        const f = action.correction.field;
        results[action.correction.itemId] = {
          ...cur,
          [f]: action.correction.correctedValue,
          need_human_review: false,
        } as AnalysisResult;
      }
      // 修正后聚类与风险结论需要重算，这里先失效，由页面触发重算
      return {
        ...state,
        results,
        corrections: [...state.corrections, action.correction],
        clusters: [],
        risk: undefined,
        report: undefined,
      };
    }
    case "reanalyzed": {
      const results = { ...state.results, [action.itemId]: action.result };
      const items = state.items.map((it) =>
        it.id === action.itemId ? { ...it, status: "analyzed" as const, error: undefined } : it
      );
      return { ...state, results, items, clusters: [], risk: undefined, report: undefined };
    }
    case "message":
      return { ...state, message: action.message };
    case "reset":
      return { ...initialState, hydrated: true };
    default:
      return state;
  }
}

interface StoreValue extends State {
  stats: DatasetStats | null;
  correctedIds: Set<string>;
  loadSnapshot: () => Promise<void>;
  ingest: (raw: RawItem[], sourceType: SourceType, datasetName?: string) => Promise<void>;
  runAnalysis: () => Promise<void>;
  recompute: () => Promise<void>;
  correct: (itemId: string, field: Correction["field"], value: string, originalValue: string) => void;
  reanalyze: (itemId: string) => Promise<void>;
  generateReport: (range: { start: string; end: string }) => Promise<void>;
  confirmRisk: (note: string) => void;
  reset: () => void;
  setMessage: (m?: Message) => void;
}

const StoreContext = createContext<StoreValue | null>(null);
const STORAGE_KEY = "yujian-ai-state-v1";

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const savedRef = useRef(false);

  // 恢复本地状态：让用户刷新页面后不丢失已经分析过的结果
  useEffect(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<State>;
        dispatch({ type: "hydrate", payload: { ...p, hydrated: true, busy: undefined, progress: undefined } });
      } else {
        dispatch({ type: "hydrate", payload: {} });
      }
    } catch {
      dispatch({ type: "hydrate", payload: {} });
    }
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    const t = setTimeout(() => {
      try {
        const { busy, progress, message, ...persist } = state;
        void busy; void progress; void message;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
      } catch {
        /* 超出配额时忽略，不影响使用 */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [state]);

  const correctedIds = useMemo(
    () => new Set(state.corrections.map((c) => c.itemId)),
    [state.corrections]
  );

  // 指标是纯函数计算的，放在客户端算可以避免多余的往返
  const stats = useMemo(() => {
    if (state.items.length === 0) return null;
    const map = new Map(Object.entries(state.results));
    return computeStats(state.items, map, correctedIds);
  }, [state.items, state.results, correctedIds]);

  const ingest = useCallback(
    async (raw: RawItem[], sourceType: SourceType, datasetName?: string) => {
      dispatch({ type: "busy", label: "正在清洗数据" });
      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw, sourceType }),
        });
        const data = (await res.json()) as {
          items: OpinionItem[];
          stats: CleaningStats;
          error?: string;
        };
        if (data.error) {
          dispatch({ type: "message", message: { kind: "danger", text: data.error } });
          dispatch({ type: "busy" });
          return;
        }
        if (data.items.length === 0) {
          dispatch({
            type: "message",
            message: {
              kind: "warn",
              text: `采集到 ${data.stats.fetched} 条，但全部被判定为重复或噪声，没有可分析的内容。建议更换关键词或放宽时间范围。`,
            },
          });
          dispatch({ type: "busy" });
          return;
        }
        dispatch({ type: "setItems", items: data.items, cleaning: data.stats, datasetName });
      } catch (e) {
        dispatch({
          type: "message",
          message: { kind: "danger", text: `数据清洗失败：${e instanceof Error ? e.message : "未知错误"}` },
        });
        dispatch({ type: "busy" });
      }
    },
    []
  );

  const loadSnapshot = useCallback(async () => {
    await ingest(SNAPSHOT_RAW, "snapshot", "AI 行业舆情 · 示例快照");
  }, [ingest]);

  const runAnalysis = useCallback(async () => {
    if (state.items.length === 0) return;
    dispatch({ type: "busy", label: "正在分析", progress: { done: 0, total: state.items.length } });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: state.items }),
      });
      const data = (await res.json()) as {
        results: [string, AnalysisResult][];
        failed: string[];
        engine: "mock" | "live";
        error?: string;
      };
      if (data.error) {
        dispatch({ type: "message", message: { kind: "danger", text: data.error } });
        dispatch({ type: "busy" });
        return;
      }
      dispatch({
        type: "analyzed",
        results: Object.fromEntries(data.results),
        failed: data.failed,
        engine: data.engine,
      });
      dispatch({
        type: "message",
        message:
          data.failed.length > 0
            ? { kind: "warn", text: `分析完成，其中 ${data.failed.length} 条失败，可在列表中单独重试。` }
            : { kind: "ok", text: `分析完成，共 ${data.results.length} 条。` },
      });
    } catch (e) {
      dispatch({
        type: "message",
        message: { kind: "danger", text: `分析失败：${e instanceof Error ? e.message : "未知错误"}` },
      });
      dispatch({ type: "busy" });
    }
  }, [state.items]);

  const recompute = useCallback(async () => {
    if (state.items.length === 0 || Object.keys(state.results).length === 0) return;
    dispatch({ type: "busy", label: "正在重算聚类与风险" });
    const map = new Map(Object.entries(state.results));
    try {
      const cRes = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: state.items, results: Object.fromEntries(map) }),
      });
      const cData = (await cRes.json()) as { clusters: Cluster[]; note?: string };
      dispatch({ type: "clusters", clusters: cData.clusters ?? [], note: cData.note });

      const rRes = await fetch("/api/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: state.items,
          results: Object.fromEntries(map),
          clusters: cData.clusters ?? [],
          corrections: state.corrections,
        }),
      });
      const rData = (await rRes.json()) as { assessment: RiskAssessment };
      dispatch({ type: "risk", risk: rData.assessment });
      dispatch({ type: "busy" });
    } catch (e) {
      dispatch({
        type: "message",
        message: { kind: "danger", text: `重算失败：${e instanceof Error ? e.message : "未知错误"}` },
      });
      dispatch({ type: "busy" });
    }
  }, [state.items, state.results, state.corrections]);

  const correct = useCallback(
    (itemId: string, field: Correction["field"], value: string, originalValue: string) => {
      if (value === originalValue) return;
      dispatch({
        type: "correct",
        correction: {
          id: `cor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          itemId,
          field,
          originalValue,
          correctedValue: value,
          correctedAt: new Date().toISOString(),
        },
      });
      dispatch({
        type: "message",
        message: { kind: "ok", text: "已修正。聚类与风险结论需要重新计算，请点击「重算结论」。" },
      });
    },
    []
  );

  const reanalyze = useCallback(
    async (itemId: string) => {
      const item = state.items.find((i) => i.id === itemId);
      if (!item) return;
      dispatch({ type: "busy", label: "正在重新分析单条" });
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [item] }),
        });
        const data = (await res.json()) as { results: [string, AnalysisResult][] };
        const first = data.results?.[0];
        if (first) dispatch({ type: "reanalyzed", itemId: first[0], result: first[1] });
        dispatch({ type: "busy" });
      } catch {
        dispatch({ type: "busy" });
        dispatch({ type: "message", message: { kind: "danger", text: "重新分析失败。" } });
      }
    },
    [state.items]
  );

  const generateReport = useCallback(
    async (range: { start: string; end: string }) => {
      if (!stats || !state.risk) return;
      dispatch({ type: "busy", label: "正在生成简报" });
      try {
        const res = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stats,
            clusters: state.clusters,
            assessment: state.risk,
            corrections: state.corrections,
            range,
          }),
        });
        const data = (await res.json()) as { report: Report };
        dispatch({ type: "report", report: data.report });
        dispatch({ type: "busy" });
      } catch {
        dispatch({ type: "busy" });
        dispatch({ type: "message", message: { kind: "danger", text: "简报生成失败。" } });
      }
    },
    [stats, state.risk, state.clusters, state.corrections]
  );

  const confirmRisk = useCallback(
    (note: string) => {
      if (!state.risk) return;
      dispatch({
        type: "risk",
        risk: { ...state.risk, confirmed: true, confirmNote: note },
      });
      dispatch({ type: "message", message: { kind: "ok", text: "已记录人工确认。" } });
    },
    [state.risk]
  );

  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const setMessage = useCallback((m?: Message) => dispatch({ type: "message", message: m }), []);

  const value: StoreValue = {
    ...state,
    stats,
    correctedIds,
    loadSnapshot,
    ingest,
    runAnalysis,
    recompute,
    correct,
    reanalyze,
    generateReport,
    confirmRisk,
    reset,
    setMessage,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore 必须在 StoreProvider 内使用");
  return ctx;
}

export function useItemMap(): Map<string, OpinionItem> {
  const { items } = useStore();
  return useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
}

export function useResultMap(): Map<string, AnalysisResult> {
  const { results } = useStore();
  return useMemo(() => new Map(Object.entries(results)), [results]);
}
