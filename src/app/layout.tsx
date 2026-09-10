import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "健康评估科普，不构成医学建议。",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
