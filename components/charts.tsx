"use client";

// 舆见 AI —— 图表
// 只封装真正需要的三种：环形（占比）、面积折线（趋势）、横向条（分布）。
// 图表数量刻意控制：一屏不超过 5 个，多出来的信息一律用文字或表格表达。

import React, { useEffect, useRef } from "react";
import type { EChartsOption } from "echarts";

function useChart(option: EChartsOption) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<unknown>(null);

  useEffect(() => {
    let disposed = false;
    let instance: { setOption: (o: EChartsOption) => void; resize: () => void; dispose: () => void } | null = null;

    (async () => {
      const echarts = await import("echarts");
      if (disposed || !ref.current) return;
      instance = echarts.init(ref.current, undefined, { renderer: "canvas" });
      instance.setOption(option);
      chartRef.current = instance;
    })();

    const onResize = () => instance?.resize();
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      instance?.dispose();
    };
    // option 每次都重新生成，这里以序列化结果作为依赖避免无限重渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(option)]);

  return ref;
}

function css(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function DonutChart({
  data,
  centerValue,
  centerLabel,
  height = 200,
}: {
  data: { name: string; value: number; color: string }[];
  centerValue: string;
  centerLabel: string;
  height?: number;
}) {
  const option: EChartsOption = {
    tooltip: { trigger: "item", formatter: "{b}: {c} 条 ({d}%)" },
    series: [
      {
        type: "pie",
        radius: ["62%", "84%"],
        avoidLabelOverlap: true,
        itemStyle: { borderWidth: 2, borderColor: "transparent" },
        label: { show: false },
        labelLine: { show: false },
        data: data.map((d) => ({
          name: d.name,
          value: d.value,
          itemStyle: { color: d.color },
        })),
      },
    ],
    graphic: [
      {
        type: "text",
        left: "center",
        top: "44%",
        style: { text: centerValue, fontSize: 22, fontWeight: 650, fill: "currentColor", align: "center" },
      },
      {
        type: "text",
        left: "center",
        top: "58%",
        style: { text: centerLabel, fontSize: 11, fill: "#9AA1AC", align: "center" },
      },
    ],
  };
  const ref = useChart(option);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

export function TrendChart({
  dates,
  total,
  negative,
  height = 190,
}: {
  dates: string[];
  total: number[];
  negative: number[];
  height?: number;
}) {
  const option: EChartsOption = {
    grid: { left: 34, right: 14, top: 22, bottom: 26 },
    tooltip: { trigger: "axis" },
    legend: { right: 0, top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: "#D8DDE5" } },
      axisLabel: { fontSize: 10, color: "#9AA1AC" },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "rgba(150,160,175,.18)" } },
      axisLabel: { fontSize: 10, color: "#9AA1AC" },
    },
    series: [
      {
        name: "舆情总量",
        type: "line",
        smooth: true,
        symbolSize: 5,
        data: total,
        lineStyle: { width: 2.4, color: "#2B5CE6" },
        itemStyle: { color: "#2B5CE6" },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(43,92,230,.22)" },
              { offset: 1, color: "rgba(43,92,230,0)" },
            ],
          },
        },
      },
      {
        name: "负面量",
        type: "line",
        smooth: true,
        symbolSize: 4,
        data: negative,
        lineStyle: { width: 2, color: "#D33A32", type: "dashed" },
        itemStyle: { color: "#D33A32" },
      },
    ],
  };
  const ref = useChart(option);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

export { css };
