"use client";

// 舆见 AI —— 基础展示组件
// 注意这里刻意把「情绪」和「风险」做成两个不同的组件（SentimentTag / RiskTag），
// 因为它们在产品逻辑上是两个独立维度，混用会让用户误以为负面就等于高风险。

import React from "react";
import type { RiskLevel, Sentiment } from "@/lib/types";
import { RISK_LABEL, SENTIMENT_LABEL } from "@/lib/types";

export function SentimentTag({ value }: { value: Sentiment }) {
  const cls = value === "positive" ? "pos" : value === "negative" ? "neg" : "neu";
  const color =
    value === "positive" ? "var(--pos)" : value === "negative" ? "var(--neg)" : "var(--neu)";
  return (
    <span className={`tag ${cls}`}>
      <i className="dot" style={{ background: color }} />
      {SENTIMENT_LABEL[value]}
    </span>
  );
}

export function RiskTag({ value }: { value: RiskLevel }) {
  return <span className={`tag r-${value}`}>{RISK_LABEL[value]}</span>;
}

export function StatCard({
  label,
  value,
  unit,
  detail,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  detail?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v" style={tone ? { color: tone } : undefined}>
        {value}
        {unit ? <em>{unit}</em> : null}
      </div>
      {detail ? <div className="d">{detail}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  sub,
  right,
  children,
  className,
}: {
  title?: string;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel ${className ?? ""}`}>
      {title ? (
        <div className="panel-head">
          <h4>{title}</h4>
          {sub ? <span className="sub">{sub}</span> : null}
          {right ? <span className="right">{right}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function BarList({
  rows,
  color = "var(--brand)",
  max,
}: {
  rows: { label: string; value: number; color?: string }[];
  color?: string;
  max?: number;
}) {
  const peak = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="brow" key={r.label}>
          <span className="lbl" title={r.label}>
            {r.label}
          </span>
          <span className="track">
            <span
              className="fill"
              style={{ width: `${Math.max(2, (r.value / peak) * 100)}%`, background: r.color ?? color }}
            />
          </span>
          <span className="val">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChipList({
  rows,
  onPick,
  active,
}: {
  rows: { term: string; count: number }[];
  onPick?: (term: string) => void;
  active?: string;
}) {
  return (
    <div className="chips">
      {rows.map((r) => (
        <span
          key={r.term}
          className={`chip ${active === r.term ? "on" : ""}`}
          onClick={() => onPick?.(r.term)}
        >
          {r.term} <b>{r.count}</b>
        </span>
      ))}
    </div>
  );
}

export function Empty({
  title,
  desc,
  action,
}: {
  title: string;
  desc: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="et">{title}</div>
      <div className="ed">{desc}</div>
      {action}
    </div>
  );
}

export function Banner({
  kind = "info",
  children,
}: {
  kind?: "info" | "warn" | "danger" | "ok";
  children: React.ReactNode;
}) {
  return <div className={`banner ${kind}`}>{children}</div>;
}

export function Spinner() {
  return <span className="spin" />;
}

export function Note({ children }: { children: React.ReactNode }) {
  return <div className="note">{children}</div>;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
