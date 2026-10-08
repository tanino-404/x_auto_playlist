import { describe, expect, it } from "vitest";
import { matchMutation, observedMutationMessage } from "@/lib/interceptor";
import { POST_ACTION_OPERATIONS } from "@/shared/constants";
import { isObservedMutation, OBSERVED_MUTATION_MESSAGE_TYPE } from "@/shared/messages";

describe("observedMutationMessage (F-4C)", () => {
  it.each([...POST_ACTION_OPERATIONS])("forwards %s with its query id", (operation) => {
    const message = observedMutationMessage(
      `https://x.com/i/api/graphql/lI07N6Otwv1PhnEgXILM7A/${operation}`,
    );
    expect(message).toEqual({
      type: OBSERVED_MUTATION_MESSAGE_TYPE,
      operation,
      queryId: "lI07N6Otwv1PhnEgXILM7A",
    });
    expect(isObservedMutation(message)).toBe(true);
  });

  it("accepts relative URLs and ignores the query string", () => {
    expect(matchMutation("/i/api/graphql/ab-C_1/CreateBookmark?x=1")).toEqual({
      operation: "CreateBookmark",
      queryId: "ab-C_1",
    });
  });

  it.each([
    "https://x.com/i/api/graphql/q/HomeTimeline",
    "https://x.com/i/api/graphql/q/CreateTweet",
    "https://x.com/i/api/graphql/q/FavoriteTweetX",
    "https://x.com/i/api/graphql/FavoriteTweet",
    "https://x.com/home?u=/i/api/graphql/q/FavoriteTweet",
    "",
  ])("ignores %j", (url) => {
    expect(observedMutationMessage(url)).toBeNull();
  });
});
