// Pure post-id extraction for right-click "add" (docs/architecture.md §6.4).
// Works on a minimal element-like interface so it can be unit tested without a DOM.

/** The subset of Element that the extraction needs. */
export interface ElementLike {
  getAttribute(name: string): string | null;
  closest(selector: string): ElementLike | null;
  querySelectorAll(selector: string): Iterable<ElementLike>;
}

export const ARTICLE_SELECTORS = [
  'article[data-testid="tweet"]',
  'article[role="article"]',
] as const;
export const STATUS_LINK_SELECTOR = 'a[href*="/status/"]';
/** Quoted posts are rendered inside a div[role="link"] within the outer article. */
export const QUOTE_SELECTOR = 'div[role="link"]';

const STATUS_ID_PATTERN = /\/status\/(\d+)/;

/** "/user/status/123/photo/1" → "123". */
export function postIdFromHref(href: string | null): string | null {
  if (href === null) {
    return null;
  }
  return STATUS_ID_PATTERN.exec(href)?.[1] ?? null;
}

/** The post article that contains `target`, or null. */
export function findArticle(target: ElementLike): ElementLike | null {
  for (const selector of ARTICLE_SELECTORS) {
    const article = target.closest(selector);
    if (article !== null) {
      return article;
    }
  }
  return null;
}

/**
 * True when `el` sits inside a quoted post of `article`: its nearest div[role="link"]
 * ancestor exists and is itself inside `article` (its closest article is `article`).
 */
function isInsideQuote(el: ElementLike, article: ElementLike): boolean {
  const quote = el.closest(QUOTE_SELECTOR);
  if (quote === null) {
    return false;
  }
  return findArticle(quote) === article;
}

/**
 * Post id of `article`: the status link wrapping a <time> (the post's own timestamp) wins;
 * otherwise the first status link that is not inside a quoted post.
 */
export function extractPostId(article: ElementLike): string | null {
  for (const time of article.querySelectorAll("time")) {
    const link = time.closest(STATUS_LINK_SELECTOR);
    if (link === null || isInsideQuote(link, article)) {
      continue;
    }
    const id = postIdFromHref(link.getAttribute("href"));
    if (id !== null) {
      return id;
    }
  }
  for (const link of article.querySelectorAll(STATUS_LINK_SELECTOR)) {
    if (isInsideQuote(link, article)) {
      continue;
    }
    const id = postIdFromHref(link.getAttribute("href"));
    if (id !== null) {
      return id;
    }
  }
  return null;
}
