// Hands the post-actions module to the player's media info bar without threading it through
// PlayerWindow's props (F-4C). Provided by App; null when not wired (the buttons then hide).
import { createContext } from "preact";
import type { PostActions } from "@/lib/post-actions";
import type { Store } from "@/lib/store";

export interface PostActionsContextValue {
  postActions: PostActions;
  store: Store;
}

export const PostActionsContext = createContext<PostActionsContextValue | null>(null);
