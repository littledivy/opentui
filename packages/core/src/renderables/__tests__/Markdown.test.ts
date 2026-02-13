import "../../testing/test-setup.ts"
import { test, beforeEach, afterEach } from "jsr:@std/testing/bdd"
import { expect } from "jsr:@std/expect"
import { MarkdownRenderable } from "../Markdown"
import { TextRenderable } from "../Text"
import { SyntaxStyle } from "../../syntax-style"
import { RGBA } from "../../lib/RGBA"
import { createTestRenderer, type TestRenderer } from "../../testing"
import { TextAttributes, type CapturedFrame } from "../../types"
import { assertSnapshot } from "jsr:@std/testing/snapshot"

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let captureSpans: () => CapturedFrame

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
})

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 60, height: 40 })
  renderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
  captureSpans = testRenderer.captureSpans
})

afterEach(async () => {
  if (renderer) {
    renderer.destroy()
  }
})

async function renderMarkdown(markdown: string, conceal: boolean = true): Promise<string> {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: markdown,
    syntaxStyle,
    conceal,
  })

  renderer.root.add(md)
  await renderOnce()

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  return "\n" + lines.join("\n").trimEnd()
}

test("basic table alignment", async (t) => {
  const markdown = `| Name | Age |
|---|---|
| Alice | 30 |
| Bob | 5 |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with inline code (backticks)", async (t) => {
  const markdown = `| Command | Description |
|---|---|
| \`npm install\` | Install deps |
| \`npm run build\` | Build project |
| \`npm test\` | Run tests |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with bold text", async (t) => {
  const markdown = `| Feature | Status |
|---|---|
| **Authentication** | Done |
| **API** | WIP |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with italic text", async (t) => {
  const markdown = `| Item | Note |
|---|---|
| One | *important* |
| Two | *ok* |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with mixed formatting", async (t) => {
  const markdown = `| Type | Value | Notes |
|---|---|---|
| **Bold** | \`code\` | *italic* |
| Plain | **strong** | \`cmd\` |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with alignment markers (left, center, right)", async (t) => {
  const markdown = `| Left | Center | Right |
|:---|:---:|---:|
| A | B | C |
| Long text | X | Y |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with empty cells", async (t) => {
  const markdown = `| A | B |
|---|---|
| X |  |
|  | Y |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with long header and short content", async (t) => {
  const markdown = `| Very Long Column Header | Short |
|---|---|
| A | B |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with short header and long content", async (t) => {
  const markdown = `| X | Y |
|---|---|
| This is very long content | Short |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table inside code block should NOT be formatted", async (t) => {
  const markdown = `\`\`\`
| Not | A | Table |
|---|---|---|
| Should | Stay | Raw |
\`\`\`

| Real | Table |
|---|---|
| Is | Formatted |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("multiple tables in same document", async (t) => {
  const markdown = `| Table1 | A |
|---|---|
| X | Y |

Some text between.

| Table2 | BB |
|---|---|
| Long content | Z |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with escaped pipe character", async (t) => {
  const markdown = `| Command | Output |
|---|---|
| echo | Hello |
| ls \\| grep | Filtered |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with unicode characters", async (t) => {
  const markdown = `| Emoji | Name |
|---|---|
| 🎉 | Party |
| 🚀 | Rocket |
| 日本語 | Japanese |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with links", async (t) => {
  const markdown = `| Name | Link |
|---|---|
| Google | [link](https://google.com) |
| GitHub | [gh](https://github.com) |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("single row table (header + delimiter only)", async (t) => {
  const markdown = `| Only | Header |
|---|---|`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with many columns", async (t) => {
  const markdown = `| A | B | C | D | E |
|---|---|---|---|---|
| 1 | 2 | 3 | 4 | 5 |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("no tables returns original content", async (t) => {
  const markdown = `# Just a heading

Some paragraph text.

- List item`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table with nested inline formatting", async (t) => {
  const markdown = `| Description |
|---|
| This has **bold and \`code\`** together |
| And *italic with **nested bold*** |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

// Tests with conceal=false - formatting markers should be visible and columns sized accordingly

test("conceal=false: table with bold text", async (t) => {
  const markdown = `| Feature | Status |
|---|---|
| **Authentication** | Done |
| **API** | WIP |`

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

test("conceal=false: table with inline code", async (t) => {
  const markdown = `| Command | Description |
|---|---|
| \`npm install\` | Install deps |
| \`npm run build\` | Build project |`

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

test("conceal=false: table with italic text", async (t) => {
  const markdown = `| Item | Note |
|---|---|
| One | *important* |
| Two | *ok* |`

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

test("conceal=false: table with mixed formatting", async (t) => {
  const markdown = `| Type | Value | Notes |
|---|---|---|
| **Bold** | \`code\` | *italic* |
| Plain | **strong** | \`cmd\` |`

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

test("conceal=false: table with unicode characters", async (t) => {
  const markdown = `| Emoji | Name |
|---|---|
| 🎉 | Party |
| 🚀 | Rocket |
| 日本語 | Japanese |`

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

test("conceal=false: basic table alignment", async (t) => {
  const markdown = `| Name | Age |
|---|---|
| Alice | 30 |
| Bob | 5 |`

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

test("table with paragraphs before and after", async (t) => {
  const markdown = `This is a paragraph before the table.

| Name | Age |
|---|---|
| Alice | 30 |

This is a paragraph after the table.`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

// Code block tests

test("code block with language", async (t) => {
  const markdown = `\`\`\`typescript
const x = 1;
console.log(x);
\`\`\``

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("code block without language", async (t) => {
  const markdown = `\`\`\`
plain code block
with multiple lines
\`\`\``

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("code block mixed with text", async (t) => {
  const markdown = `Here is some code:

\`\`\`js
function hello() {
  return "world";
}
\`\`\`

And here is more text after.`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("multiple code blocks", async (t) => {
  const markdown = `First block:

\`\`\`python
print("hello")
\`\`\`

Second block:

\`\`\`rust
fn main() {}
\`\`\``

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("code block in conceal=false mode", async (t) => {
  const markdown = `\`\`\`js
const x = 1;
\`\`\``

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

// Heading tests

test("headings h1 through h3", async (t) => {
  const markdown = `# Heading 1

## Heading 2

### Heading 3`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("headings with conceal=false show markers", async (t) => {
  const markdown = `# Heading 1

## Heading 2`

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

// List tests

test("unordered list", async (t) => {
  const markdown = `- Item one
- Item two
- Item three`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("ordered list", async (t) => {
  const markdown = `1. First item
2. Second item
3. Third item`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("list with inline formatting", async (t) => {
  const markdown = `- **Bold** item
- *Italic* item
- \`Code\` item`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

// Blockquote tests

test("simple blockquote", async (t) => {
  const markdown = `> This is a quote
> spanning multiple lines`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

// Inline formatting tests

test("bold text", async (t) => {
  const markdown = `This has **bold** text in it.`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("italic text", async (t) => {
  const markdown = `This has *italic* text in it.`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("inline code", async (t) => {
  const markdown = `Use \`console.log()\` to debug.`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("mixed inline formatting", async (t) => {
  const markdown = `**Bold**, *italic*, and \`code\` together.`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("inline formatting with conceal=false", async (t) => {
  const markdown = `**Bold**, *italic*, and \`code\` together.`

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

// Link tests

test("links with conceal mode", async (t) => {
  const markdown = `Check out [OpenTUI](https://github.com/sst/opentui) for more.`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("links with conceal=false", async (t) => {
  const markdown = `Check out [OpenTUI](https://github.com/sst/opentui) for more.`

  await assertSnapshot(t, await renderMarkdown(markdown, false))
})

// Horizontal rule

test("horizontal rule", async (t) => {
  const markdown = `Before

---

After`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

// Complex document

test("complex markdown document", async (t) => {
  const markdown = `# Project Title

Welcome to **OpenTUI**, a terminal UI library.

## Features

- Automatic table alignment
- \`inline code\` support
- *Italic* and **bold** text

## Code Example

\`\`\`typescript
const md = new MarkdownRenderable(ctx, {
  content: "# Hello",
})
\`\`\`

## Links

Visit [GitHub](https://github.com) for more.

---

*Press \`?\` for help*`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

// Custom renderNode tests

test("custom renderNode can override heading rendering", async (t) => {
  const { TextRenderable } = await import("../Text")
  const { StyledText } = await import("../../lib/styled-text")

  // Helper to extract text from marked tokens
  const extractText = (node: any): string => {
    if (node.type === "text") return node.text
    if (node.tokens) return node.tokens.map(extractText).join("")
    return ""
  }

  const md = new MarkdownRenderable(renderer, {
    id: "custom-heading",
    content: `# Custom Heading

Regular paragraph.`,
    syntaxStyle,
    renderNode: (node, ctx) => {
      if (node.type === "heading") {
        const text = extractText(node)
        return new TextRenderable(renderer, {
          id: "custom",
          content: new StyledText([{ __isChunk: true, text: `[CUSTOM] ${text}`, attributes: 0 }]),
          width: "100%",
        })
      }
      return ctx.defaultRender()
    },
  })

  renderer.root.add(md)
  await renderOnce()

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  await assertSnapshot(t, "\n" + lines.join("\n").trimEnd())
})

test("custom renderNode can override code block rendering", async (t) => {
  const { BoxRenderable } = await import("../Box")
  const { TextRenderable } = await import("../Text")

  const md = new MarkdownRenderable(renderer, {
    id: "custom-code",
    content: `\`\`\`js
const x = 1;
\`\`\``,
    syntaxStyle,
    renderNode: (node, ctx) => {
      if (node.type === "code") {
        const box = new BoxRenderable(renderer, {
          id: "code-box",
          border: true,
          borderStyle: "single",
        })
        box.add(
          new TextRenderable(renderer, {
            id: "code-text",
            content: `CODE: ${(node as any).text}`,
          }),
        )
        return box
      }
      return ctx.defaultRender()
    },
  })

  renderer.root.add(md)
  await renderOnce()

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  await assertSnapshot(t, "\n" + lines.join("\n").trimEnd())
})

test("custom renderNode returning null uses default", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "custom-null",
    content: `# Heading

Paragraph text.`,
    syntaxStyle,
    renderNode: () => null,
  })

  renderer.root.add(md)
  await renderOnce()

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  await assertSnapshot(t, "\n" + lines.join("\n").trimEnd())
})

// Incomplete/invalid markdown tests

test("incomplete code block (no closing fence)", async (t) => {
  const markdown = `Here is some code:

\`\`\`javascript
const x = 1;
console.log(x);`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("incomplete bold (no closing **)", async (t) => {
  const markdown = `This has **unclosed bold text`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("incomplete italic (no closing *)", async (t) => {
  const markdown = `This has *unclosed italic text`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("incomplete link (no closing paren)", async (t) => {
  const markdown = `Check out [this link](https://example.com`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("incomplete table (only header)", async (t) => {
  const markdown = `| Header1 | Header2 |`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("incomplete table (header + delimiter, no rows)", async (t) => {
  const markdown = `| Header1 | Header2 |
|---|---|`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("streaming-like content with partial code block", async (t) => {
  const markdown = `# Title

Some text before code.

\`\`\`py`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("malformed table with missing pipes", async (t) => {
  const markdown = `| A | B
|---|---
| 1 | 2`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("trailing blank lines do not add spacing", async (t) => {
  const markdown = `# Heading

Paragraph text.


`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("multiple trailing blank lines do not add spacing", async (t) => {
  const markdown = `First paragraph.

Second paragraph.



`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("blank lines between blocks add spacing", async (t) => {
  const markdown = `First

Second

Third`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("code block at end with trailing blank lines", async (t) => {
  const markdown = `Text before

\`\`\`js
const x = 1;
\`\`\`

`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

test("table at end with trailing blank lines", async (t) => {
  const markdown = `| A | B |
|---|---|
| 1 | 2 |


`

  await assertSnapshot(t, await renderMarkdown(markdown))
})

// Incremental parsing tests
test("incremental update reuses unchanged blocks when appending", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "# Hello\n\nParagraph 1",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderOnce()

  // Get reference to first block
  const firstBlockBefore = md._blockStates[0]?.renderable

  // Append content
  md.content = "# Hello\n\nParagraph 1\n\nParagraph 2"
  await renderOnce()

  // First block should be reused (same object reference)
  const firstBlockAfter = md._blockStates[0]?.renderable
  expect(firstBlockAfter).toBe(firstBlockBefore)
})

test("streaming mode keeps trailing tokens unstable", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "# Hello",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderOnce()

  const frame1 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
  expect(frame1).toContain("Hello")

  // Extend the heading
  md.content = "# Hello World"
  await renderOnce()

  const frame2 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
  expect(frame2).toContain("Hello World")
})

test("non-streaming mode parses all tokens as stable", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "# Hello\n\nPara 1\n\nPara 2",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderOnce()

  // Get parse state
  const parseState = md._parseState
  expect(parseState).not.toBeNull()
  expect(parseState!.tokens.length).toBeGreaterThan(0)
})

test("content update with same text does not rebuild", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "# Hello",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderOnce()

  const blockBefore = md._blockStates[0]?.renderable

  // Set same content
  md.content = "# Hello"
  await renderOnce()

  const blockAfter = md._blockStates[0]?.renderable
  expect(blockAfter).toBe(blockBefore)
})

test("block type change creates new renderable", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "# Hello",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderOnce()

  const blockBefore = md._blockStates[0]?.renderable

  // Change from heading to paragraph
  md.content = "Hello"
  await renderOnce()

  const blockAfter = md._blockStates[0]?.renderable
  // Should be different renderable since type changed
  expect(blockAfter).not.toBe(blockBefore)
})

test("streaming property can be toggled", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "# Hello",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderOnce()

  expect(md.streaming).toBe(false)

  md.streaming = true
  expect(md.streaming).toBe(true)

  await renderOnce()

  const frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
  expect(frame).toContain("Hello")
})

test("clearCache forces full rebuild", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "# Hello\n\nWorld",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderOnce()

  const parseStateBefore = md._parseState

  md.clearCache()
  await renderOnce()

  const parseStateAfter = md._parseState
  // Parse state should be different (was cleared and rebuilt)
  expect(parseStateAfter).not.toBe(parseStateBefore)
})

test("table only rebuilds when complete row count changes during streaming", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "| A |\n|---|\n| 1 |",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderOnce()

  // During streaming with 1 row, we show 0 complete rows (last row is incomplete)
  const tableBefore = md._blockStates[0]?.renderable

  // Change cell content but same row count - should NOT rebuild
  md.content = "| B |\n|---|\n| 2 |"
  await renderOnce()

  const tableAfterSameRows = md._blockStates[0]?.renderable
  expect(tableAfterSameRows).toBe(tableBefore)

  // Add second row - now we have 1 complete row, should rebuild
  md.content = "| B |\n|---|\n| 2 |\n| 3 |"
  await renderOnce()

  const tableAfterNewRow = md._blockStates[0]?.renderable
  expect(tableAfterNewRow).not.toBe(tableBefore)
})

test("table shows all rows when streaming is false", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "| A |\n|---|\n| 1 |",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderOnce()

  // Non-streaming should show all rows including the last
  const frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  expect(frame).toContain("1")
})

test("table updates content when not streaming", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "| A |\n|---|\n| 1 |",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderOnce()

  const frame1 = captureFrame()
  expect(frame1).toContain("1")

  // Change cell content - should update immediately when not streaming
  md.content = "| A |\n|---|\n| 2 |"
  await renderOnce()

  const frame2 = captureFrame()
  expect(frame2).toContain("2")
  expect(frame2).not.toContain("1")
})

test("streaming table with incomplete first row falls back to raw text and updates", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "| A |\n|---|\n|",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderOnce()

  // With streaming=true and 1 data row, rowsToRender drops last row -> length 0
  // Should show raw fallback text
  const frame1 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  // Raw fallback should show the incomplete table markdown
  expect(frame1).toContain("| A |")
  expect(frame1).toContain("|---|")
  // Should NOT have box drawing characters yet
  expect(frame1).not.toMatch(/[┌│└]/)

  // Now append more characters to the incomplete row
  md.content = "| A |\n|---|\n| 1"
  await renderOnce()

  const frame2 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  // Should update to show the new content in raw fallback
  expect(frame2).toContain("| 1")
  // Still no box drawing
  expect(frame2).not.toMatch(/[┌│└]/)

  // Complete the row by adding closing pipe - still only 1 row, so still 0 complete rows
  md.content = "| A |\n|---|\n| 1 |"
  await renderOnce()

  const frame3 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  // Still showing raw fallback with completed first row
  expect(frame3).toContain("| 1 |")
  // Still no box drawing
  expect(frame3).not.toMatch(/[┌│└]/)

  // Add second row - now we have 1 complete row (first row), should render as table
  md.content = "| A |\n|---|\n| 1 |\n| 2 |"
  await renderOnce()

  const frame4 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  // Should now render as a proper table with box drawing and show the first complete row
  expect(frame4).toMatch(/[┌│└]/) // Box drawing characters
  expect(frame4).toContain("1")
  // Second row should not be shown (it's the incomplete trailing row)
  expect(frame4).not.toContain("2")

  // Complete the second row - now we have 2 rows, so 1 complete row still (drops last)
  md.content = "| A |\n|---|\n| 1 |\n| 2 |"
  await renderOnce()

  const frame5 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  // Should still show proper table with only first row
  expect(frame5).toMatch(/[┌│└]/)
  expect(frame5).toContain("1")
  expect(frame5).not.toContain("2")

  // Add third row - now we have 2 complete rows to show
  md.content = "| A |\n|---|\n| 1 |\n| 2 |\n| 3 |"
  await renderOnce()

  const frame6 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  // Should show proper table with first two rows (third is incomplete)
  expect(frame6).toMatch(/[┌│└]/)
  expect(frame6).toContain("1")
  expect(frame6).toContain("2")
  expect(frame6).not.toContain("3")
})

test("streaming table transitions cleanly from raw fallback to proper table", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "| Header |",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderOnce()

  // Just header, no delimiter yet - raw fallback
  let frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  expect(frame).toContain("| Header |")
  expect(frame).not.toMatch(/[┌│└]/)

  // Add delimiter
  md.content = "| Header |\n|---|"
  await renderOnce()

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  // Still raw fallback (no data rows)
  expect(frame).toContain("|---|")
  expect(frame).not.toMatch(/[┌│└]/)

  // Start first data row
  md.content = "| Header |\n|---|\n| D"
  await renderOnce()

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  // Still raw fallback (incomplete first row)
  expect(frame).toContain("| D")
  expect(frame).not.toMatch(/[┌│└]/)

  // Complete first row - still only 1 row total, so 0 complete (drops last)
  md.content = "| Header |\n|---|\n| Data1 |"
  await renderOnce()

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  // Still raw fallback
  expect(frame).toContain("| Data1 |")
  expect(frame).not.toMatch(/[┌│└]/)

  // Add start of second row
  md.content = "| Header |\n|---|\n| Data1 |\n| D"
  await renderOnce()

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  // NOW should render as proper table showing first complete row
  expect(frame).toMatch(/[┌│└]/)
  expect(frame).toContain("Data1")
  // Should NOT show the raw markdown pipes anymore
  expect(frame).not.toContain("|---|")
  // Should not show incomplete second row
  expect(frame).not.toContain("| D")
})

test("streaming table can transition back to raw fallback when rows are removed", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "| A |\n|---|\n| 1 |\n| 2 |",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderOnce()

  // With 2 rows, we have 1 complete row - should render as table
  let frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  expect(frame).toMatch(/[┌│└]/)
  expect(frame).toContain("1")

  // Remove second row - back to 1 row, so 0 complete rows
  md.content = "| A |\n|---|\n| 1 |"
  await renderOnce()

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  // Should fall back to raw text
  expect(frame).not.toMatch(/[┌│└]/)
  expect(frame).toContain("| A |")
  expect(frame).toContain("|---|")
  expect(frame).toContain("| 1 |")
})

test("conceal change updates rendered content", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "# Hello **bold**",
    syntaxStyle,
    conceal: true,
  })

  renderer.root.add(md)
  await renderOnce()

  const frame1 = captureFrame()
  expect(frame1).not.toContain("**")
  expect(frame1).not.toContain("#")

  md.conceal = false
  await renderOnce()

  const frame2 = captureFrame()
  expect(frame2).toContain("**")
  expect(frame2).toContain("#")
})

test("theme switching (syntaxStyle change)", async (t) => {
  const theme1 = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 0, 0, 1) }, // Red
    "markup.heading.1": { fg: RGBA.fromValues(0, 1, 0, 1), bold: true }, // Green
  })

  const theme2 = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(0, 0, 1, 1) }, // Blue
    "markup.heading.1": { fg: RGBA.fromValues(1, 1, 0, 1), bold: true }, // Yellow
  })

  // Use the EXACT content from markdown-demo.ts to reproduce the issue
  const content = `# OpenTUI Markdown Demo

Welcome to the **MarkdownRenderable** showcase! This demonstrates automatic table alignment and syntax highlighting.

## Features

- Automatic **table column alignment** based on content width
- Proper handling of \`inline code\`, **bold**, and *italic* in tables
- Multiple syntax themes to choose from
- Conceal mode hides formatting markers

## Comparison Table

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Table alignment | **Done** | High | Uses \`marked\` parser |
| Conceal mode | *Working* | Medium | Hides \`**\`, \`\`\`, etc. |
| Theme switching | **Done** | Low | 3 themes available |
| Unicode support | 日本語 | High | CJK characters |

## Code Examples

Here's how to use it:

\`\`\`typescript
import { MarkdownRenderable } from "@opentui/core"

const md = new MarkdownRenderable(renderer, {
  content: "# Hello World",
  syntaxStyle: mySyntaxStyle,
  conceal: true, // Hide formatting markers
})
\`\`\`

### API Reference

| Method | Parameters | Returns | Description |
|---|---|---|---|
| \`constructor\` | \`ctx, options\` | \`MarkdownRenderable\` | Create new instance |
| \`clearCache\` | none | \`void\` | Force re-render content |

## Inline Formatting Examples

| Style | Syntax | Rendered |
|---|---|---|
| Bold | \`**text**\` | **bold text** |
| Italic | \`*text*\` | *italic text* |
| Code | \`code\` | \`inline code\` |
| Link | \`[text](url)\` | [OpenTUI](https://github.com) |

## Mixed Content

> **Note**: This blockquote contains **bold** and \`code\` formatting.
> It should render correctly with proper styling.

### Emoji Support

| Emoji | Name | Category |
|---|---|---|
| 🚀 | Rocket | Transport |
| 🎨 | Palette | Art |
| ⚡ | Lightning | Nature |
| 🔥 | Fire | Nature |

---

## Alignment Examples

| Left | Center | Right |
|:---|:---:|---:|
| L1 | C1 | R1 |
| Left aligned | Centered text | Right aligned |
| Short | Medium length | Longer content here |

## Performance

The table alignment uses:
1. AST-based parsing with \`marked\`
2. Caching for repeated content
3. Smart width calculation accounting for concealed chars

---

*Press \`?\` for keybindings*
`

  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content,
    syntaxStyle: theme1,
    conceal: true,
  })

  renderer.root.add(md)
  await renderOnce()

  const findSpanContaining = (frame: CapturedFrame, text: string) => {
    for (const line of frame.lines) {
      const span = line.spans.find((candidate) => candidate.text.includes(text))
      if (span) return span
    }
    return undefined
  }

  const frame1 = captureSpans()
  const headingSpan1 = findSpanContaining(frame1, "OpenTUI Markdown Demo")
  expect(headingSpan1).toBeDefined()
  expect(headingSpan1!.fg.r).toBe(0)
  expect(headingSpan1!.fg.g).toBe(1)
  expect(headingSpan1!.fg.b).toBe(0)
  expect(headingSpan1!.attributes & TextAttributes.BOLD).toBeTruthy()

  // Switch theme
  md.syntaxStyle = theme2
  await renderOnce()

  const frame2 = captureSpans()
  const headingSpan2 = findSpanContaining(frame2, "OpenTUI Markdown Demo")
  expect(headingSpan2).toBeDefined()
  expect(headingSpan2!.fg.r).toBe(1)
  expect(headingSpan2!.fg.g).toBe(1)
  expect(headingSpan2!.fg.b).toBe(0)
  expect(headingSpan2!.attributes & TextAttributes.BOLD).toBeTruthy()
})

// OSC 8 link metadata tests

test("link chunks include link metadata for OSC 8 hyperlinks (conceal=true)", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "Check [Google](https://google.com) out",
    syntaxStyle,
    conceal: true,
  })

  renderer.root.add(md)
  await renderOnce()

  const textRenderable = md._blockStates[0]?.renderable as TextRenderable
  const chunks = textRenderable.content.chunks
  const linkChunks = chunks.filter((c) => c.link?.url === "https://google.com")

  expect(linkChunks.length).toBeGreaterThan(0)
  expect(linkChunks.some((c) => c.text === "Google")).toBe(true)
  expect(linkChunks.some((c) => c.text === "https://google.com")).toBe(true)
})

test("link chunks include link metadata (conceal=false)", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "Check [Google](https://google.com) out",
    syntaxStyle,
    conceal: false,
  })

  renderer.root.add(md)
  await renderOnce()

  const textRenderable = md._blockStates[0]?.renderable as TextRenderable
  const chunks = textRenderable.content.chunks
  const linkChunks = chunks.filter((c) => c.link?.url === "https://google.com")

  expect(linkChunks.length).toBeGreaterThan(0)
  expect(linkChunks.some((c) => c.text === "Google")).toBe(true)
  expect(linkChunks.some((c) => c.text === "https://google.com")).toBe(true)
})

test("image chunks include link metadata", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "![alt](https://example.com/img.png)",
    syntaxStyle,
    conceal: true,
  })

  renderer.root.add(md)
  await renderOnce()

  const textRenderable = md._blockStates[0]?.renderable as TextRenderable
  const chunks = textRenderable.content.chunks
  const linkChunks = chunks.filter((c) => c.link?.url === "https://example.com/img.png")
  expect(linkChunks.length).toBeGreaterThan(0)
})

test("non-link text does not have link metadata", async (t) => {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: "No links here, just **bold** text.",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderOnce()

  const textRenderable = md._blockStates[0]?.renderable as TextRenderable
  const chunks = textRenderable.content.chunks
  expect(chunks.every((c) => !c.link)).toBe(true)
})
