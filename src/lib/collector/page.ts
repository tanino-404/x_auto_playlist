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
  SearchTimeline: ["search"],
  TweetDetail: ["status"],
};

export function operationToPageKinds(operation: string): PageKind[] {
  const kinds = Object.hasOwn(OPERATION_PAGES, operation) ? OPERATION_PAGES[operation] : undefined;
  return kinds ? [...kinds] : [];
}
