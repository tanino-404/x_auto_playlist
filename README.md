# X Auto Playlist

English | [日本語](README_JP.md)

A Google Chrome extension that turns the videos and images in your X (formerly Twitter) timeline into a **playlist you can watch back to back**.

With X still open, a playlist panel appears on the right side of the page and the videos play one after another in a small floating player. Think of it as a music player, but for the videos on X.

![Playing a video](docs/images/readme-playing.png)

## Good for

- You are tired of opening timeline videos one by one
- You want to watch the videos you saved to Likes or Bookmarks in one go
- You want X videos running on the side while you do something else

## What it does

### Builds a playlist automatically

Every video and image on the page you are viewing (Home, Bookmarks, Likes, a user's Posts / Replies / Reposts / Media tabs, search results) is added to the playlist for you. When playback gets close to the end of the list, the page scrolls a little at a time to load more.

### Lets you build your own playlist

Right-click a post and choose "Add to playlist" or "Play next" to put it in the manual playlist. A post with four photos adds all four. The manual playlist stays until you close the browser, and playback resumes where you left off.

### The player window

Play / pause, previous / next, repeat (all or one), shuffle, a seek bar, volume (hover and scroll the wheel), playback speed, quality (auto, or any resolution the post offers), picture-in-picture, and fullscreen. The playlist panel can stay open next to the video even in fullscreen.

The author and the post text are shown under the video. Press "Full text" to read the whole post, and like or repost it right there.

### The playlist panel

![The playlist panel](docs/images/readme-panel.png)

Hover a thumbnail to preview the first seconds. Double-click an item to play from there, drag items to reorder them (manual mode), and use the "⋮" menu to remove an item, play it next, or open the original post. Items you have already watched can be dimmed or removed automatically.

### Keyboard shortcuts

Available while the player window is open. They are ignored while you are typing.

| Key | Action |
|---|---|
| Space | Play / pause |
| ← → | Back / forward 5 seconds |
| Shift + ← → | Previous / next item |
| ↑ ↓ | Volume |
| F | Fullscreen |
| M | Mute |
| L | Cycle repeat mode |
| S | Shuffle |
| P | Picture-in-picture |

## Settings

![Settings](docs/images/readme-settings.png)

Open them from the gear icon at the top right of the panel.

| Setting | What it does |
|---|---|
| Language | Language of the panel and player: Auto (follows the browser), 日本語, or English. |
| Playlist mode | "Auto" collects from the page you are viewing. "Manual" uses only the items you added by right-clicking. |
| Theme | Look of the panel and player: light, dark, or follow the system. |
| Include images | Turn off to collect videos only. |
| Image display time | How many seconds an image or GIF is shown before moving on (1 to 20). |
| Default quality | Quality used when playback starts: auto, highest, or lowest. While playing, the quality menu in the player lists the exact resolutions the post offers. |
| Thumbnail hover preview | When on, hovering a thumbnail plays its first seconds. Turn off to save bandwidth. |
| Prefetch | Loads the next video ahead of time to cut the gap between videos: off, next item, or previous and next. |
| Auto-scroll | In auto mode, scrolls the page to load more posts when the list is nearly finished. |
| Auto-scroll pace | How often it scrolls: slow, normal, or fast. Faster paces load more quickly but raise the chance that X temporarily limits loading. |
| Default volume | Volume when the extension starts. |
| Default repeat | Repeat mode when the extension starts: all, one, or off. |
| Pause X's videos while playing | Stops the videos that autoplay in the X timeline while the player is running. |
| Skip duplicates | Adds a video only once even if it shows up again as a repost. |
| Keyboard shortcuts | Whether the keys in the table above are active. |
| Watched items | What happens to items you have watched: keep, dim, or remove automatically. |
| Post actions in the player | Whether the like and repost buttons are shown in the player. |

## Install

The extension is not on the Chrome Web Store. You load it into Chrome yourself.

1. Download the latest `x-auto-playlist-<version>-chrome.zip` from **Releases** on the right side of this page.
2. Unzip it. You get a folder.
3. Type `chrome://extensions` in Chrome's address bar and open it.
4. Turn on **Developer mode** at the top right.
5. Click **Load unpacked** and pick the folder from step 2.
6. A teal icon appears in the toolbar. If you do not see it, pin it from the puzzle-piece menu.

To update, unzip the new version over the same folder and press the reload arrow for the extension on `chrome://extensions`.

## How to use

1. Sign in to X (x.com) and open Home or History (Bookmarks / Likes).
2. Click the toolbar icon. The panel opens on the right and fills with the videos and images on that page.
3. Press the **play button** in the panel, or **double-click** an item, to start. Playback never starts on its own just because items were added.
4. Items you added by right-clicking are in the **Manual** list, selected at the top of the panel.
5. Drag the divider between the page and the panel to resize it. Close the panel with the "×" at the top right or by clicking the toolbar icon again.

## Things to know

- **This is an unofficial tool** with no connection to X Corp. It relies on how X works internally, so a change on X's side can break it without warning. When that happens the panel shows a message saying it cannot get data from X.
- **Bookmarking is not available from the player** because of a restriction on X's side. Use X's own bookmark button.
- Liking or reposting many times in a short period may be refused by X as automated activity. Wait a while and try again.
- Some videos, such as recordings of live broadcasts, cannot be played and are shown as "unplayable".
- In a small player window the automatic quality is on the low side. Pick a resolution from the quality menu if you want it sharper.
- Nothing is collected unless you are signed in to X.
- The extension does not download or save any video or image.

## For developers

The design, requirements and build instructions live in [docs](docs/) (in Japanese): [requirements](docs/requirements.md), [architecture](docs/architecture.md), [final check](docs/final_check.md), [release notes](docs/release_notes.md). To build it yourself, use Node.js 22 or later, run `npm install` and `npm run build`, then load `.output/chrome-mv3`.

## License

[Apache License 2.0](LICENSE)
