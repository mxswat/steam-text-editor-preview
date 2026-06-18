# Steam Text Editor Preview

Preview Steam BBCode (Text Editor format) with a live preview panel that updates as you type — just like VS Code's Markdown preview.

## Features

- Live preview that opens beside your editor (Ctrl+Shift+V or click the preview icon)
- Full BBCode support matching [Steam's formatting help](https://steamcommunity.com/comment/Recommendation/formattinghelp)

### Supported Tags

| Tag | Renders As |
|---|---|
| `[h1]`–`[h3]` | Headings |
| `[b]` | Bold |
| `[i]` | Italic |
| `[u]` | Underline |
| `[strike]` / `[s]` | Strikethrough |
| `[url=]` / `[url]` | Links |
| `[img]` | Images (web URLs, local files, relative paths) |
| `[quote]` / `[quote=author]` | Blockquotes |
| `[code]` | Code blocks |
| `[spoiler]` | Expandable spoilers |
| `[list]` / `[olist]` + `[*]` | Bulleted / ordered lists |
| `[table]` / `[tr]` / `[th]` / `[td]` | Tables (`noborder=1`, `equalcells=1`) |
| `[hr]` | Horizontal rule |
| `[center]` | Centered text |
| `[size=]` / `[color=]` | Font size / color |
| `[noparse]` | Escape BBCode |

### Local Images

```
[img]https://example.com/image.png[/img]     → web URL
[img]images/steam.png[/img]                   → relative to open file
[img]C:\Users\me\Pictures\art.png[/img]       → absolute local path
```

## Usage

1. Open a `.steambb` or `.bbcode` file
2. Press **Ctrl+Shift+V** or click the preview icon in the editor title bar
3. The preview panel updates live as you type

## Requirements

- VS Code 1.84+

## Extension Settings

None currently.
