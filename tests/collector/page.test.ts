import { describe, expect, it } from "vitest";
import { operationToPageKinds } from "@/lib/collector/page";
import { TARGET_OPERATIONS } from "@/shared/constants";

describe("operationToPageKinds", () => {
  it.each([
    ["HomeTimeline", ["home"]],
    ["HomeLatestTimeline", ["home"]],
    ["Bookmarks", ["bookmarks"]],
    ["Likes", ["likes"]],
    ["UserVideoTimeline", ["user-media"]],
    ["UserPhotoTimeline", ["user-media"]],
    ["UserMedia", ["user-media"]],
    ["UserOriginalsTimeline", ["user-posts"]],
    ["UserTweets", ["user-posts"]],
    ["UserHighlightsTweets", ["user-posts"]],
    ["UserHighlightsTimeline", ["user-posts"]],
    ["UserRepliesTimeline", ["user-replies"]],
    ["UserTweetsAndReplies", ["user-replies"]],
    ["UserRepostsTimeline", ["user-reposts"]],
    ["SearchTimeline", ["search"]],
    ["TweetDetail", ["status"]],
  ])("%s → %j", (operation, kinds) => {
    expect(operationToPageKinds(operation)).toEqual(kinds);
  });

  it("maps every target operation to at least one page", () => {
    for (const operation of TARGET_OPERATIONS) {
      expect(operationToPageKinds(operation).length).toBeGreaterThan(0);
    }
  });

  it.each(["", "UserRetweets", "UserReposts", "toString", "__proto__", "hometimeline"])(
    "unknown %j → []",
    (operation) => {
      expect(operationToPageKinds(operation)).toEqual([]);
    },
  );

  it("returns a fresh array each time", () => {
    const first = operationToPageKinds("Likes");
    first.push("home");
    expect(operationToPageKinds("Likes")).toEqual(["likes"]);
  });
});
