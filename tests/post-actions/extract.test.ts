import { describe, expect, it } from "vitest";
import { extractQueryIds } from "@/lib/post-actions";
import { clientLanguage, hasAllQueryIds } from "@/lib/post-actions/logic";

const EXPECTED = {
  FavoriteTweet: "lI07N6Otwv1PhnEgXILM7A",
  UnfavoriteTweet: "ZYKSe-w7KEslx3JhSIk5LA",
  CreateBookmark: "aoDbu3RHznuiSkQ9aNM67Q",
  DeleteBookmark: "Wlmlj2-xzyS1GN3a6cj-mQ",
  CreateRetweet: "ojPdsZsimiJrUGLR1sjUtA",
  DeleteRetweet: "iQtK4dl5hBmXewYZuEOKVw",
} as const;

/** Mimics main.*.js: one webpack module per GraphQL operation. */
function bundle(order: "forward" | "reverse"): string {
  const modules = Object.entries(EXPECTED).map(([operation, queryId], index) => {
    const pair =
      order === "forward"
        ? `queryId:"${queryId}",operationName:"${operation}"`
        : `operationName:"${operation}",queryId:"${queryId}"`;
    return `${99799 + index}(e){e.exports={${pair},operationType:"mutation",metadata:{featureSwitches:[],fieldToggles:[]}}}`;
  });
  return [
    "n.d(t,{a:()=>r});",
    `12(e){e.exports={queryId:"HOMEqid",operationName:"HomeTimeline",operationType:"query"}}`,
    ...modules,
    `13(e){e.exports={queryId:"TWEETqid",operationName:"CreateTweet",operationType:"mutation"}}`,
  ].join(",");
}

describe("extractQueryIds", () => {
  it("finds the six post-action mutations (queryId first)", () => {
    const ids = extractQueryIds(bundle("forward"));
    expect(ids).toEqual(EXPECTED);
    expect(hasAllQueryIds(ids)).toBe(true);
  });

  it("finds them when operationName comes first", () => {
    expect(extractQueryIds(bundle("reverse"))).toEqual(EXPECTED);
  });

  it("ignores other operations and returns a partial result", () => {
    const source =
      `a(e){e.exports={queryId:"x1",operationName:"CreateTweet"}},` +
      `b(e){e.exports={queryId:"lI07N6Otwv1PhnEgXILM7A",operationName:"FavoriteTweet"}}`;
    const ids = extractQueryIds(source);
    expect(ids).toEqual({ FavoriteTweet: "lI07N6Otwv1PhnEgXILM7A" });
    expect(hasAllQueryIds(ids)).toBe(false);
  });

  it("does not match a longer operation name", () => {
    expect(extractQueryIds(`{queryId:"q",operationName:"FavoriteTweetV2"}`)).toEqual({});
  });

  it("returns {} for empty input", () => {
    expect(extractQueryIds("")).toEqual({});
  });
});

describe("clientLanguage", () => {
  it("uses the first two letters of navigator.language, defaulting to ja", () => {
    expect(clientLanguage("ja-JP")).toBe("ja");
    expect(clientLanguage("en-US")).toBe("en");
    expect(clientLanguage("")).toBe("ja");
    expect(clientLanguage(undefined)).toBe("ja");
  });
});
