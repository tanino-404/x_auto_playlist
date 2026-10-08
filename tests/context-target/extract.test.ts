import { describe, expect, it } from "vitest";
import {
  type ElementLike,
  extractPostId,
  findArticle,
  postIdFromHref,
} from "@/lib/context-target/extract";

// Minimal fake DOM: supports `tag`, `tag[attr="v"]` and `tag[attr*="v"]` selectors.
const SELECTOR_PATTERN = /^([a-z]+)(?:\[([a-z-]+)(\*?)="([^"]*)"\])?$/;

class FakeElement implements ElementLike {
  parent: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  constructor(
    readonly tag: string,
    readonly attrs: Record<string, string> = {},
    children: FakeElement[] = [],
  ) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  matches(selector: string): boolean {
    const m = SELECTOR_PATTERN.exec(selector);
    if (m === null) {
      throw new Error(`unsupported selector ${selector}`);
    }
    const [, tag, attr, star, value] = m;
    if (tag !== this.tag) {
      return false;
    }
    if (attr === undefined || value === undefined) {
      return true;
    }
    const actual = this.attrs[attr];
    if (actual === undefined) {
      return false;
    }
    return star === "*" ? actual.includes(value) : actual === value;
  }
  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node !== null) {
      if (node.matches(selector)) {
        return node;
      }
      node = node.parent;
    }
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const result: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          result.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return result;
  }
}

const el = (tag: string, attrs: Record<string, string> = {}, ...children: FakeElement[]) =>
  new FakeElement(tag, attrs, children);

describe("postIdFromHref", () => {
  it("extracts the numeric id", () => {
    expect(postIdFromHref("/alice/status/1234567890")).toBe("1234567890");
    expect(postIdFromHref("https://x.com/alice/status/42/photo/1")).toBe("42");
    expect(postIdFromHref("/alice/likes")).toBeNull();
    expect(postIdFromHref(null)).toBeNull();
  });
});

describe("extractPostId", () => {
  it("prefers the link wrapping <time>", () => {
    const article = el(
      "article",
      { "data-testid": "tweet" },
      el("a", { href: "/bob/status/999/analytics" }),
      el("a", { href: "/alice/status/111" }, el("time")),
    );
    expect(extractPostId(article)).toBe("111");
  });

  it("ignores the quoted post's time link", () => {
    const article = el(
      "article",
      { "data-testid": "tweet" },
      el("div", { role: "link" }, el("a", { href: "/carol/status/555" }, el("time"))),
      el("a", { href: "/alice/status/222" }, el("time")),
    );
    expect(extractPostId(article)).toBe("222");
  });

  it("falls back to a status link outside the quote when there is no usable time", () => {
    const article = el(
      "article",
      { role: "article" },
      el("div", { role: "link" }, el("a", { href: "/carol/status/555" })),
      el("a", { href: "/alice/status/333/photo/1" }),
    );
    expect(extractPostId(article)).toBe("333");
  });

  it("returns null without status links", () => {
    expect(extractPostId(el("article", {}, el("a", { href: "/alice" })))).toBeNull();
  });

  it("does not treat a div[role=link] outside the article as a quote", () => {
    const article = el(
      "article",
      { "data-testid": "tweet" },
      el("a", { href: "/alice/status/444" }, el("time")),
    );
    el("div", { role: "link" }, article);
    expect(extractPostId(article)).toBe("444");
  });
});

describe("findArticle", () => {
  it("walks up to the tweet article (or role=article)", () => {
    const img = el("img");
    const article = el("article", { "data-testid": "tweet" }, el("div", {}, img));
    expect(findArticle(img)).toBe(article);

    const span = el("span");
    const generic = el("article", { role: "article" }, span);
    expect(findArticle(span)).toBe(generic);

    expect(findArticle(el("div"))).toBeNull();
  });
});
