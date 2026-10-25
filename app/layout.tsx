import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "舆见 AI · 舆情分析工作台",
  description:
    "面向舆情与公关从业者的 AI 分析工作台：把读文本、判情绪、找观点、评风险、写简报的重复劳动压缩成一条可复核的流水线。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 让 env(safe-area-inset-*) 生效，底部导航栏才不会压在 iPhone 的home 指示条上
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <StoreProvider>
          <Shell>{children}</Shell>
        </StoreProvider>
      </body>
    </html>
  );
}
