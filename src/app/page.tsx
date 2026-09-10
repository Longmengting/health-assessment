import React from "react";

import { APP_NAME } from "../lib/app-config";
import AssessmentClient from "./assessment-client";

export default function HomePage() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">健康科普评估</p>
        <h1>{APP_NAME}</h1>
        <p className="lede">4 步个性化定制，开启你的健康目标之旅。</p>
        <a className="start-link" href="#assessment">开始我的评估</a>
        <p className="trust">隐私保护 · 仅需 2 分钟 · 无需注册</p>
      </header>
      <div id="assessment"><AssessmentClient /></div>
      <footer>本评估为健康科普，不构成医学建议。</footer>
    </main>
  );
}
