import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage from "../../src/app/page";

describe("assessment home page", () => {
  it("renders the complete local-demo funnel entry points", () => {
    const html = renderToStaticMarkup(createElement(HomePage));

    expect(html).toContain("开始我的评估");
    expect(html).toContain("4 步个性化定制");
    expect(html).toContain("健康科普评估");
    expect(html).toContain("不构成医学建议");
  });
});
