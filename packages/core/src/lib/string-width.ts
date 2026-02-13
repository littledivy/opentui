// Pure-JS string width measurement for terminal display.
// Covers ASCII, common CJK, and fullwidth/halfwidth forms.

function isFullWidth(cp: number): boolean {
  // CJK Unified Ideographs
  if (cp >= 0x4e00 && cp <= 0x9fff) return true
  // CJK Extension A
  if (cp >= 0x3400 && cp <= 0x4dbf) return true
  // CJK Extension B
  if (cp >= 0x20000 && cp <= 0x2a6df) return true
  // CJK Compatibility Ideographs
  if (cp >= 0xf900 && cp <= 0xfaff) return true
  // Fullwidth Forms
  if (cp >= 0xff01 && cp <= 0xff60) return true
  if (cp >= 0xffe0 && cp <= 0xffe6) return true
  // Hangul Jamo
  if (cp >= 0x1100 && cp <= 0x115f) return true
  // Hangul Jamo Extended-A
  if (cp >= 0xa960 && cp <= 0xa97c) return true
  // Hangul Syllables
  if (cp >= 0xac00 && cp <= 0xd7a3) return true
  // Hangul Jamo Extended-B
  if (cp >= 0xd7b0 && cp <= 0xd7ff) return true
  // CJK Radicals Supplement, Kangxi Radicals
  if (cp >= 0x2e80 && cp <= 0x2fdf) return true
  // CJK Symbols and Punctuation through Katakana
  if (cp >= 0x3000 && cp <= 0x30ff) return true
  // Bopomofo through CJK Strokes
  if (cp >= 0x3100 && cp <= 0x31ef) return true
  // Enclosed CJK Letters
  if (cp >= 0x3200 && cp <= 0x32ff) return true
  // CJK Compatibility
  if (cp >= 0x3300 && cp <= 0x33ff) return true
  // Enclosed Ideographic Supplement
  if (cp >= 0x1f200 && cp <= 0x1f2ff) return true
  return false
}

function isZeroWidth(cp: number): boolean {
  // Combining marks, zero-width chars
  if (cp >= 0x0300 && cp <= 0x036f) return true // Combining Diacritical Marks
  if (cp >= 0x1ab0 && cp <= 0x1aff) return true // Combining Diacritical Marks Extended
  if (cp >= 0x1dc0 && cp <= 0x1dff) return true // Combining Diacritical Marks Supplement
  if (cp >= 0x20d0 && cp <= 0x20ff) return true // Combining Diacritical Marks for Symbols
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true // Variation Selectors
  if (cp >= 0xfe20 && cp <= 0xfe2f) return true // Combining Half Marks
  if (cp === 0x200b) return true // Zero Width Space
  if (cp === 0x200c) return true // Zero Width Non-Joiner
  if (cp === 0x200d) return true // Zero Width Joiner
  if (cp === 0x2060) return true // Word Joiner
  if (cp === 0xfeff) return true // Zero Width No-Break Space
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true // Variation Selectors Supplement
  return false
}

export function stringWidth(str: string): number {
  let width = 0
  for (const char of str) {
    const cp = char.codePointAt(0)!
    // Control characters
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue
    if (isZeroWidth(cp)) continue
    if (isFullWidth(cp)) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}
