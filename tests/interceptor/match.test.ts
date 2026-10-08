import { describe, expect, it } from "vitest";
import { matchOperation, parseRateLimitHeader } from "@/lib/interceptor/match";
import { TARGET_OPERATIONS } from "@/shared/constants";

describe("matchOperation", () => {
  it.each([...TARGET_OPERATIONS])("matches %s regardless of queryId", (operation) => {
    expect(matchOperation(`https://x.com/i/api/graphql/AbC-123_xyz/${operation}`)).toBe(operation);
    expect(matchOperation(`https://x.com/i/api/graphql/zzz/${operation}?variables=%7B%7D`)).toBe(
      operation,
    );
  });

  it("treats bundle.<Operation> as <Operation>", () => {
    expect(matchOperation("https://x.com/i/api/graphql/q1/bundle.HomeTimeline?variables=x")).toBe(
      "HomeTimeline",
    );
    expect(matchOperation("/i/api/graphql/q1/bundle.Likes")).toBe("Likes");
    expect(matchOperation("https://x.com/i/api/graphql/q1/bundle.UserTweets")).toBeNull();
  });

  it("accepts relative URLs (XHR open() is often called with a path)", () => {
    expect(matchOperation("/i/api/graphql/q1/HomeTimeline?variables=%7B%22count%22%3A20%7D")).toBe(
      "HomeTimeline",
    );
  });

  it("does not look at the query string", () => {
    expect(
      matchOperation("https://x.com/i/api/graphql/q/UserTweets?next=/i/api/graphql/q/Likes"),
    ).toBeNull();
  });

  it.each([
    "https://x.com/i/api/graphql/q/UserTweets",
    "https://x.com/i/api/graphql/q/CreateTweet",
    "https://x.com/i/api/2/notifications/all.json",
    "https://x.com/home",
    "https://x.com/i/api/graphql/HomeTimeline",
    "",
  ])("rejects %j", (url) => {
    expect(matchOperation(url)).toBeNull();
  });
});

describe("parseRateLimitHeader", () => {
  it.each([
    ["42", 42],
    ["1790000000", 1790000000],
    [null, null],
    [undefined, null],
    ["", null],
    ["abc", null],
  ])("%j → %j", (value, expected) => {
    expect(parseRateLimitHeader(value)).toBe(expected);
  });
});
