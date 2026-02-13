// Strip ANSI escape sequences from a string.

// Matches:
// - ESC [ ... letter  (CSI sequences)
// - ESC ] ... ST      (OSC sequences)
// - ESC ( letter      (charset selection)
// - ESC single char   (simple escapes)
const ANSI_PATTERN = /\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\([A-Z]|[A-Z@-_])/g

export function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, "")
}
