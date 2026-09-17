import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/html.js";

describe("escapeHtml", () => {
  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Algorithms & Data Structures")).toBe("Algorithms &amp; Data Structures");
  });

  it("escapes all five special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("neutralises a course name shaped like markup instead of rendering it", () => {
    expect(escapeHtml('<b onclick="alert(1)">x</b>')).toBe(
      "&lt;b onclick=&quot;alert(1)&quot;&gt;x&lt;/b&gt;",
    );
  });

  it("returns an empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });
});
