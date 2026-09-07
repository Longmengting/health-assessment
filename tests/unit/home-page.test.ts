import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage from "../../src/app/page";

describe("assessment home page", () => {
  it("renders the complete local-demo funnel entry points", () => {
    const html = renderToStaticMarkup(createElement(HomePage));

    expect(html).toContain("Start my assessment");
    expect(html).toContain("4 short steps");
    expect(html).toContain("Educational wellness estimate");
    expect(html).toContain("not medical advice");
  });
});
