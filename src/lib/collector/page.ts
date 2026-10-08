// Which pages a GraphQL operation feeds (docs/architecture.md §6.1).

import type { PageKind } from "@/shared/types";

const OPERATION_PAGES: Readonly<Record<string, readonly PageKind[]>> = {
  HomeTimeline: ["home"],
  HomeLatestTimeline: ["home"],
  Bookmarks: ["bookmarks"],
  Likes: ["likes"],
  UserVideoTimeline: ["user-media"],
  UserPhotoTimeline: ["user-media"],
  UserMedia: ["user-media"],
  // Profile tabs (F-61), confirmed on the live site 2026-10-08. The older names (UserTweets,
  // UserTweetsAndReplies, highlights) are kept in case X switches back.
  UserOriginalsTimeline: ["user-posts"],
  UserTweets: ["user-posts"],
  UserHighlightsTweets: ["user-posts"],
  UserHighlightsTimeline: ["user-posts"],
  UserRepliesTimeline: ["user-replies"],
  UserTweetsAndReplies: ["user-replies"],
  UserRepostsTimeline: ["user-reposts"],
  SearchTimeline: ["search"],
  TweetDetail: ["status"],
};

export function operationToPageKinds(operation: string): PageKind[] {
  const kinds = Object.hasOwn(OPERATION_PAGES, operation) ? OPERATION_PAGES[operation] : undefined;
  return kinds ? [...kinds] : [];
}
