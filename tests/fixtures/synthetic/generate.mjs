// Regenerates the synthetic fixtures in this folder (Node standard library only):
//   node tests/fixtures/synthetic/generate.mjs && npx biome format --write tests/fixtures/synthetic
// home-timeline.json cases: ① video ② 4 photos ③ GIF ④ repost ⑤ quote
// ⑥ TweetWithVisibilityResults ⑦ TweetTombstone ⑧ no media ⑨ note_tweet
// ⑩ new/legacy author structures, plus an HLS-only video, two ads, TimelineShowAlert, cursors.
// user-originals-timeline.json: profile posts tab (pinned post, two-video post, conversation module, repost, ad).
// Real captures belong in ../real/ (git-ignored), never here.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL(".", import.meta.url));

// Users: new structure (2026-07+) and legacy structure.
const newUser = (id, screenName, name) => ({
  __typename: "User",
  id: `VXNlcjo${id}`,
  rest_id: id,
  core: { created_at: "Mon Jan 01 00:00:00 +0000 2024", name, screen_name: screenName },
  avatar: { image_url: `https://pbs.twimg.com/profile_images/${id}/${screenName}_normal.jpg` },
  legacy: { followers_count: 10, description: "" },
});
const oldUser = (id, screenName, name) => ({
  __typename: "User",
  id: `VXNlcjo${id}`,
  rest_id: id,
  legacy: {
    name,
    screen_name: screenName,
    profile_image_url_https: `https://pbs.twimg.com/profile_images/${id}/${screenName}_normal.jpg`,
    followers_count: 10,
  },
});

const alice = newUser("101", "alice", "Alice");
const bob = oldUser("102", "bob", "Bob");
const carol = newUser("103", "carol", "Carol");
const dave = oldUser("104", "dave", "Dave");

const photo = (key, file, w = 1200, h = 800) => ({
  display_url: "pic.x.com/abc",
  id_str: key.split("_")[1],
  media_key: key,
  media_url_https: `https://pbs.twimg.com/media/${file}`,
  type: "photo",
  original_info: { width: w, height: h },
  sizes: { large: { w, h, resize: "fit" } },
});

const video = (key, idNum, { duration = 12345, mp4 = true, hls = true } = {}) => {
  const variants = [];
  if (hls) {
    variants.push({
      content_type: "application/x-mpegURL",
      url: `https://video.twimg.com/ext_tw_video/${idNum}/pu/pl/abc.m3u8?tag=12`,
    });
  }
  if (mp4) {
    variants.push(
      {
        bitrate: 832000,
        content_type: "video/mp4",
        url: `https://video.twimg.com/ext_tw_video/${idNum}/pu/vid/avc1/640x360/mid.mp4?tag=12`,
      },
      {
        bitrate: 2176000,
        content_type: "video/mp4",
        url: `https://video.twimg.com/ext_tw_video/${idNum}/pu/vid/avc1/1280x720/high.mp4?tag=12`,
      },
      {
        bitrate: 256000,
        content_type: "video/mp4",
        url: `https://video.twimg.com/ext_tw_video/${idNum}/pu/vid/avc1/320x180/low.mp4?tag=12`,
      },
    );
  }
  return {
    display_url: "pic.x.com/vid",
    id_str: String(idNum),
    media_key: key,
    media_url_https: `https://pbs.twimg.com/ext_tw_video_thumb/${idNum}/pu/img/thumb.jpg`,
    type: "video",
    original_info: { width: 1280, height: 720 },
    video_info: { aspect_ratio: [16, 9], duration_millis: duration, variants },
  };
};

const gif = (key, idNum) => ({
  display_url: "pic.x.com/gif",
  id_str: String(idNum),
  media_key: key,
  media_url_https: `https://pbs.twimg.com/tweet_video_thumb/G${idNum}.jpg`,
  type: "animated_gif",
  original_info: { width: 480, height: 270 },
  video_info: {
    aspect_ratio: [16, 9],
    variants: [
      {
        bitrate: 0,
        content_type: "video/mp4",
        url: `https://video.twimg.com/tweet_video/G${idNum}.mp4`,
      },
    ],
  },
});

const tweet = (id, user, text, media, extra = {}) => {
  const legacy = {
    id_str: id,
    full_text: text,
    created_at: "Mon Sep 28 00:00:00 +0000 2026",
    entities: { hashtags: [], urls: [] },
    ...(media ? { extended_entities: { media } } : {}),
    ...(extra.legacy ?? {}),
  };
  const result = {
    __typename: "Tweet",
    rest_id: id,
    core: { user_results: { result: user } },
    legacy,
    views: { count: "100", state: "EnabledWithCount" },
  };
  if (extra.quoted) result.quoted_status_result = { result: extra.quoted };
  if (extra.note)
    result.note_tweet = {
      is_expandable: true,
      note_tweet_results: { result: { id: "Tm90ZT", text: extra.note } },
    };
  return result;
};

const entry = (entryId, result, sortIndex) => ({
  entryId,
  sortIndex: String(sortIndex),
  content: {
    entryType: "TimelineTimelineItem",
    __typename: "TimelineTimelineItem",
    itemContent: {
      itemType: "TimelineTweet",
      __typename: "TimelineTweet",
      tweet_results: { result },
      tweetDisplayType: "Tweet",
    },
  },
});

const promoted = (entryId, result, sortIndex) => {
  const e = entry(entryId, result, sortIndex);
  e.content.itemContent.promotedMetadata = {
    advertiser_results: { result: { __typename: "User" } },
    disclosureType: "NoDisclosure",
    impressionId: "6f2a",
  };
  return e;
};

const cursor = (kind, sortIndex) => ({
  entryId: `cursor-${kind.toLowerCase()}-${sortIndex}`,
  sortIndex: String(sortIndex),
  content: {
    entryType: "TimelineTimelineCursor",
    __typename: "TimelineTimelineCursor",
    value: "DAABCgABG",
    cursorType: kind,
  },
});

const write = (name, data) => writeFileSync(`${OUT}${name}`, `${JSON.stringify(data, null, 2)}\n`);

// ---------------------------------------------------------------------------------------------
// home-timeline.json
// ---------------------------------------------------------------------------------------------
const home = {
  data: {
    home: {
      home_timeline_urt: {
        instructions: [
          {
            type: "TimelineShowAlert",
            alertType: "NewTweets",
            usersResults: [{ result: alice }],
            richText: { text: "New posts", entities: [] },
          },
          {
            type: "TimelineAddEntries",
            entries: [
              cursor("Top", 9002),
              // ad (entryId prefix): has media, must still be excluded
              promoted(
                "promoted-tweet-1011-6f2a",
                tweet("1011", carol, "ad", [video("13_11001", 11001)]),
                9001,
              ),
              // ① video (new-structure author)
              entry(
                "tweet-1001",
                tweet("1001", alice, "video post https://t.co/v1", [video("7_1001", 1001)]),
                9001,
              ),
              // ② 4 photos (legacy-structure author), one PNG
              entry(
                "tweet-1002",
                tweet("1002", bob, "four photos", [
                  photo("3_2001", "p2001.jpg"),
                  photo("3_2002", "p2002.png"),
                  photo("3_2003", "p2003.jpg"),
                  photo("3_2004", "p2004.jpg"),
                ]),
                9000,
              ),
              // ③ GIF
              entry("tweet-1003", tweet("1003", alice, "a gif", [gif("16_3001", 3001)]), 8999),
              // ④ repost by bob of carol's video post (media is on the original)
              entry(
                "tweet-1004",
                tweet("1004", bob, "RT @carol: original video", null, {
                  legacy: {
                    retweeted_status_result: {
                      result: tweet("1040", carol, "original video", [video("7_4001", 4001)]),
                    },
                  },
                }),
                8998,
              ),
              // ⑤ quote: body has a photo, quoted post (legacy author) has a video
              entry(
                "tweet-1005",
                tweet("1005", alice, "look at this", [photo("3_5001", "p5001.jpg")], {
                  quoted: tweet("1050", dave, "quoted video", [video("7_5001", 5001)]),
                }),
                8997,
              ),
              // ⑥ TweetWithVisibilityResults wrapping a video post
              entry(
                "tweet-1006",
                {
                  __typename: "TweetWithVisibilityResults",
                  tweet: tweet("1006", carol, "limited visibility video", [video("7_6001", 6001)]),
                  limitedActionResults: { limited_actions: [] },
                },
                8996,
              ),
              // ⑦ tombstone
              entry(
                "tweet-1007",
                {
                  __typename: "TweetTombstone",
                  tombstone: { text: { text: "This post is unavailable." } },
                },
                8995,
              ),
              // ⑧ no media
              entry("tweet-1008", tweet("1008", bob, "just text", null), 8994),
              // ⑨ long post (note_tweet) with a video
              entry(
                "tweet-1009",
                tweet("1009", dave, "truncated text…", [video("7_9001", 9001)], {
                  note: "This is the full long text of the post, longer than the legacy full_text.",
                }),
                8993,
              ),
              // extra: long video with HLS only (T-02: not playable)
              entry(
                "tweet-1010",
                tweet("1010", alice, "long video", [
                  video("7_10001", 10001, { duration: 3_600_000, mp4: false }),
                ]),
                8992,
              ),
              // ad (promotedMetadata only)
              promoted(
                "tweet-1012",
                tweet("1012", carol, "ad 2", [photo("3_12001", "p12001.jpg")]),
                8991,
              ),
              cursor("Bottom", 8990),
            ],
          },
        ],
        metadata: { scribeConfig: { page: "following" } },
      },
    },
  },
};
write("home-timeline.json", home);

// ---------------------------------------------------------------------------------------------
// bookmarks.json
// ---------------------------------------------------------------------------------------------
write("bookmarks.json", {
  data: {
    bookmark_timeline_v2: {
      timeline: {
        instructions: [
          {
            type: "TimelineAddEntries",
            entries: [
              entry(
                "tweet-2001",
                tweet("2001", carol, "bookmarked video", [video("7_20001", 20001)]),
                500,
              ),
              cursor("Bottom", 499),
            ],
          },
        ],
      },
    },
  },
});

// ---------------------------------------------------------------------------------------------
// likes.json
// ---------------------------------------------------------------------------------------------
write("likes.json", {
  data: {
    user: {
      result: {
        __typename: "User",
        timeline: {
          timeline: {
            instructions: [
              { type: "TimelineClearCache" },
              {
                type: "TimelineAddEntries",
                entries: [
                  entry(
                    "tweet-3001",
                    tweet("3001", bob, "liked photo", [photo("3_30001", "p30001.jpg")]),
                    700,
                  ),
                  entry(
                    "tweet-3002",
                    tweet("3002", alice, "liked gif", [gif("16_30002", 30002)]),
                    699,
                  ),
                  cursor("Bottom", 698),
                ],
              },
            ],
          },
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------------------------
// add-to-module.json (profile media grid: a module entry, then TimelineAddToModule)
// ---------------------------------------------------------------------------------------------
const moduleItem = (entryId, result) => ({
  entryId,
  item: {
    itemContent: {
      itemType: "TimelineTweet",
      __typename: "TimelineTweet",
      tweet_results: { result },
    },
  },
});
const promotedModuleItem = (entryId, result) => {
  const m = moduleItem(entryId, result);
  m.item.itemContent.promotedMetadata = { impressionId: "aa" };
  return m;
};
write("add-to-module.json", {
  data: {
    user: {
      result: {
        __typename: "User",
        timeline: {
          timeline: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  {
                    entryId: "profile-grid-0",
                    sortIndex: "900",
                    content: {
                      entryType: "TimelineTimelineModule",
                      __typename: "TimelineTimelineModule",
                      displayType: "VerticalGrid",
                      items: [
                        moduleItem(
                          "profile-grid-0-tweet-4001",
                          tweet("4001", alice, "grid 1", [video("7_40001", 40001)]),
                        ),
                        moduleItem(
                          "profile-grid-0-tweet-4002",
                          tweet("4002", alice, "grid 2", [photo("3_40002", "p40002.jpg")]),
                        ),
                      ],
                    },
                  },
                  cursor("Bottom", 899),
                ],
              },
              {
                type: "TimelineAddToModule",
                moduleEntryId: "profile-grid-0",
                moduleItems: [
                  promotedModuleItem(
                    "promoted-tweet-4099-aa",
                    tweet("4099", carol, "ad", [video("13_40099", 40099)]),
                  ),
                  moduleItem(
                    "profile-grid-0-tweet-4003",
                    tweet("4003", alice, "grid 3", [gif("16_40003", 40003)]),
                  ),
                ],
              },
            ],
          },
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------------------------
// user-originals-timeline.json (profile posts tab, UserOriginalsTimeline; F-61): pinned post, a post with two videos
// (X leaves those out of the media tab), a conversation module, a repost and an ad.
// ---------------------------------------------------------------------------------------------
write("user-originals-timeline.json", {
  data: {
    user: {
      result: {
        __typename: "User",
        timeline: {
          timeline: {
            instructions: [
              { type: "TimelineClearCache" },
              {
                type: "TimelinePinEntry",
                entry: entry(
                  "tweet-5001",
                  tweet("5001", alice, "pinned video", [video("7_50001", 50001)]),
                  1000,
                ),
              },
              {
                type: "TimelineAddEntries",
                entries: [
                  // two videos in one post
                  entry(
                    "tweet-5002",
                    tweet("5002", alice, "two videos", [
                      video("7_50021", 50021),
                      video("7_50022", 50022),
                    ]),
                    999,
                  ),
                  // conversation module: alice's thread, the second post has a photo
                  {
                    entryId: "profile-conversation-5003",
                    sortIndex: "998",
                    content: {
                      entryType: "TimelineTimelineModule",
                      __typename: "TimelineTimelineModule",
                      displayType: "VerticalConversation",
                      items: [
                        moduleItem(
                          "profile-conversation-5003-tweet-5003",
                          tweet("5003", alice, "thread start", null),
                        ),
                        moduleItem(
                          "profile-conversation-5003-tweet-5004",
                          tweet("5004", alice, "thread photo", [photo("3_50041", "p50041.jpg")]),
                        ),
                      ],
                    },
                  },
                  // repost by alice of bob's video post
                  entry(
                    "tweet-5005",
                    tweet("5005", alice, "RT @bob: reposted video", null, {
                      legacy: {
                        retweeted_status_result: {
                          result: tweet("5050", bob, "reposted video", [video("7_50051", 50051)]),
                        },
                      },
                    }),
                    997,
                  ),
                  promoted(
                    "promoted-tweet-5099-bb",
                    tweet("5099", carol, "ad", [video("13_50099", 50099)]),
                    996,
                  ),
                  cursor("Top", 995),
                  cursor("Bottom", 994),
                ],
              },
            ],
          },
        },
      },
    },
  },
});
console.log("wrote 5 synthetic fixtures");
