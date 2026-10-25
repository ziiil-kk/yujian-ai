"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React from "react";
import { useStore } from "@/lib/store";
import { Spinner } from "./ui";

const NAV = [
  { href: "/", label: "概览 Dashboard", short: "概览" },
  { href: "/input", label: "数据导入", short: "导入" },
  { href: "/analysis", label: "分析结果", short: "分析" },
  { href: "/risk", label: "风险研判", short: "风险" },
  { href: "/report", label: "舆情简报", short: "简报" },
];

function Icon({ i }: { i: number }) {
  // 极简线性图标：用 currentColor 描边，避免引入图标库
  const paths = [
    "M2 8.5 8 3.5l6 5V14H2z", // 概览
    "M8 2.5v11M3.5 7.5h9", // 导入
    "M2.5 3.5h11v9h-11zM2.5 6.5h11", // 结果
    "M8 2.5 13.5 6v6L8 13.5 2.5 12V6z", // 风险
    "M3.5 2.5h6l3 3v8h-9zM5.5 6.5h5M5.5 9h5", // 简报
  ];
  return (
    <svg className="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[i]} />
    </svg>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const store = useStore();
  const { items, stats, engine, datasetName, busy, progress, message } = store;

  const analyzedCount = Object.keys(store.results).length;

  return (
    <div className="shell">
      <aside className="sidenav">
        <div className="logo">
          <div className="logo-mark">舆</div>
          <div>
            <b>舆见 AI</b>
            <i>PUBLIC OPINION WS</i>
          </div>
        </div>

        {NAV.map((n, i) => {
          const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={`navitem ${on ? "on" : ""}`}>
              <Icon i={i} />
              <span className="nav-long">{n.label}</span>
              <span className="nav-short">{n.short}</span>
            </Link>
          );
        })}

        <div className="navfoot">
          分析引擎：{engine === "live" ? "真实模型" : "规则引擎"}
          <br />
          Prompt 版本：v0.3
          <br />
          已分析 {analyzedCount} / {items.length} 条
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="title">
            {datasetName}
            <span className="meta">
              {items.length > 0
                ? `${items.length} 条 · ${stats?.sources.length ?? 0} 个来源`
                : "尚未导入数据"}
            </span>
          </div>

          <div className="right">
            {busy ? (
              <span className="pill live">
                <Spinner /> {busy}
                {progress ? ` ${progress.done}/${progress.total}` : ""}
              </span>
            ) : null}
            <span className={`pill ${engine === "live" ? "live" : "mock"}`}>
              {engine === "live" ? "真实模型" : "模拟数据模式"}
            </span>
            <button
              className="btn"
              disabled={items.length === 0 || Boolean(busy)}
              onClick={async () => {
                await store.runAnalysis();
                router.push("/analysis");
              }}
            >
              重新分析
            </button>
            <button
              className="btn primary"
              disabled={!stats || !store.risk}
              onClick={() => router.push("/report")}
            >
              生成简报
            </button>
          </div>
        </header>

        <main className="content">
          {/*
            全局消息条。此前 store.message 从未被渲染，导致所有失败都是静默的：
            用户点了按钮、请求失败了，界面上却什么都看不到。
          */}
          {message ? (
            <div className={`banner ${message.kind}`}>
              <span style={{ flex: 1 }}>{message.text}</span>
              <button
                className="banner-x"
                onClick={() => store.setMessage(undefined)}
                aria-label="关闭提示"
              >
                ×
              </button>
            </div>
          ) : null}
          {items.length > 0 && analyzedCount === 0 && path !== "/input" ? (
            <div className="banner warn">
              数据已导入但尚未分析。请先到「数据导入」页点击开始分析，或直接使用上方的重新分析。
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
