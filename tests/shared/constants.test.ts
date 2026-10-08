import { describe, expect, it } from "vitest";
import { GRAPHQL_URL_PATTERN } from "@/shared/constants";

describe("GRAPHQL_URL_PATTERN", () => {
  it("extracts the operation name from a GraphQL URL", () => {
    const url = "https://x.com/i/api/graphql/AbC123/HomeTimeline?variables=%7B%7D";
    const match = url.match(GRAPHQL_URL_PATTERN);
    expect(match?.[1]).toBe("HomeTimeline");
  });

  it("does not match unrelated URLs", () => {
    const url = "https://x.com/i/api/1.1/some/other/endpoint.json";
    expect(GRAPHQL_URL_PATTERN.test(url)).toBe(false);
  });
});
