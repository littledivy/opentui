import { EventEmitter } from "node:events"
import { type Pointer } from "./zig-structs"
export type { Pointer }
import { type CursorStyle, type DebugOverlayCorner, type WidthMethod, type Highlight, type LineInfo } from "./types"
export type { LineInfo }

import { RGBA } from "./lib/RGBA"
import { OptimizedBuffer } from "./buffer"
import { TextBuffer } from "./text-buffer"
import { env, registerEnvVar } from "./lib/env"
import {
  StyledChunkStruct,
  HighlightStruct,
  LogicalCursorStruct,
  VisualCursorStruct,
  TerminalCapabilitiesStruct,
  EncodedCharStruct,
  LineInfoStruct,
  MeasureResultStruct,
  CursorStateStruct,
  NativeSpanFeedOptionsStruct,
  NativeSpanFeedStatsStruct,
  ReserveInfoStruct,
} from "./zig-structs"
import type { NativeSpanFeedOptions, NativeSpanFeedStats, ReserveInfo } from "./zig-structs"
import { isBunfsPath } from "./lib/bunfs"
import { attributesWithLink } from "./utils"

const archMap: Record<string, string> = { "aarch64": "arm64", "x86_64": "x64" }
const platformMap: Record<string, string> = { "darwin": "darwin", "linux": "linux", "windows": "win32" }
const arch = archMap[Deno.build.arch] ?? Deno.build.arch
const platform = platformMap[Deno.build.os] ?? Deno.build.os

const libExtMap: Record<string, string> = { "darwin": "dylib", "linux": "so", "windows": "dll" }
const libExt = libExtMap[Deno.build.os] ?? "so"

// Resolve the native library path from the npm package.
// The package @opentui/core-<platform>-<arch> contains libopentui.<ext>
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
const pkgDir = dirname(fileURLToPath(import.meta.resolve(`@opentui/core-${platform}-${arch}/package.json`)))
let targetLibPath = resolve(pkgDir, `libopentui.${libExt}`)

function existsSync(path: string): boolean {
  try {
    Deno.statSync(path)
    return true
  } catch {
    return false
  }
}

if (!existsSync(targetLibPath)) {
  throw new Error(`opentui is not supported on the current platform: ${platform}-${arch}`)
}

registerEnvVar({
  name: "OTUI_DEBUG_FFI",
  description: "Enable debug logging for the FFI bindings.",
  type: "boolean",
  default: false,
})

registerEnvVar({
  name: "OTUI_TRACE_FFI",
  description: "Enable tracing for the FFI bindings.",
  type: "boolean",
  default: false,
})

// Env vars used in terminal.zig
registerEnvVar({
  name: "OPENTUI_FORCE_WCWIDTH",
  description: "Use wcwidth for character width calculations",
  type: "boolean",
  default: false,
})
registerEnvVar({
  name: "OPENTUI_FORCE_UNICODE",
  description: "Force Mode 2026 Unicode support in terminal capabilities",
  type: "boolean",
  default: false,
})
registerEnvVar({
  name: "OPENTUI_NO_GRAPHICS",
  description: "Disable Kitty graphics protocol detection",
  type: "boolean",
  default: false,
})
registerEnvVar({
  name: "OPENTUI_FORCE_NOZWJ",
  description: "Use no_zwj width method (Unicode without ZWJ joining)",
  type: "boolean",
  default: false,
})

// Global singleton state for FFI tracing to prevent duplicate exit handlers
let globalTraceSymbols: Record<string, number[]> | null = null
let globalFFILogFile: Deno.FsFile | null = null
let exitHandlerRegistered = false

function toPointer(value: number | bigint): Pointer {
  const n = typeof value === "bigint" ? value : BigInt(value)
  return Deno.UnsafePointer.create(n)!
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value
}

function ptr(buffer: ArrayBufferView | ArrayBuffer): Pointer {
  if (buffer instanceof ArrayBuffer) {
    return Deno.UnsafePointer.of(new Uint8Array(buffer))!
  }
  return Deno.UnsafePointer.of(buffer)!
}

function toArrayBuffer(pointer: Pointer, offset: number, length: number): ArrayBuffer {
  return Deno.UnsafePointerView.getArrayBuffer(pointer, length, offset)
}

function getOpenTUILib(libPath?: string) {
  const resolvedLibPath = libPath || targetLibPath

  const rawSymbols = Deno.dlopen(resolvedLibPath, {
    // Logging
    setLogCallback: {
      parameters:["pointer"],
      result:"void",
    },
    // Event bus
    setEventCallback: {
      parameters:["pointer"],
      result:"void",
    },
    // Renderer management
    createRenderer: {
      parameters:["u32", "u32", "bool", "bool"],
      result:"pointer",
    },
    destroyRenderer: {
      parameters:["pointer"],
      result:"void",
    },
    setUseThread: {
      parameters:["pointer", "bool"],
      result:"void",
    },
    setBackgroundColor: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    setRenderOffset: {
      parameters:["pointer", "u32"],
      result:"void",
    },
    updateStats: {
      parameters:["pointer", "f64", "u32", "f64"],
      result:"void",
    },
    updateMemoryStats: {
      parameters:["pointer", "u32", "u32", "u32"],
      result:"void",
    },
    render: {
      parameters:["pointer", "bool"],
      result:"void",
    },
    getNextBuffer: {
      parameters:["pointer"],
      result:"pointer",
    },
    getCurrentBuffer: {
      parameters:["pointer"],
      result:"pointer",
    },

    queryPixelResolution: {
      parameters:["pointer"],
      result:"void",
    },

    createOptimizedBuffer: {
      parameters:["u32", "u32", "bool", "u8", "buffer", "usize"],
      result:"pointer",
    },
    destroyOptimizedBuffer: {
      parameters:["pointer"],
      result:"void",
    },

    drawFrameBuffer: {
      parameters:["pointer", "i32", "i32", "pointer", "u32", "u32", "u32", "u32"],
      result:"void",
    },
    getBufferWidth: {
      parameters:["pointer"],
      result:"u32",
    },
    getBufferHeight: {
      parameters:["pointer"],
      result:"u32",
    },
    bufferClear: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    bufferGetCharPtr: {
      parameters:["pointer"],
      result:"pointer",
    },
    bufferGetFgPtr: {
      parameters:["pointer"],
      result:"pointer",
    },
    bufferGetBgPtr: {
      parameters:["pointer"],
      result:"pointer",
    },
    bufferGetAttributesPtr: {
      parameters:["pointer"],
      result:"pointer",
    },
    bufferGetRespectAlpha: {
      parameters:["pointer"],
      result:"bool",
    },
    bufferSetRespectAlpha: {
      parameters:["pointer", "bool"],
      result:"void",
    },
    bufferGetId: {
      parameters:["pointer", "buffer", "usize"],
      result:"usize",
    },
    bufferGetRealCharSize: {
      parameters:["pointer"],
      result:"u32",
    },
    bufferWriteResolvedChars: {
      parameters:["pointer", "buffer", "usize", "bool"],
      result:"u32",
    },

    bufferDrawText: {
      parameters:["pointer", "buffer", "u32", "u32", "u32", "buffer", "buffer", "u32"],
      result:"void",
    },
    bufferSetCellWithAlphaBlending: {
      parameters:["pointer", "u32", "u32", "u32", "buffer", "buffer", "u32"],
      result:"void",
    },
    bufferSetCell: {
      parameters:["pointer", "u32", "u32", "u32", "buffer", "buffer", "u32"],
      result:"void",
    },
    bufferFillRect: {
      parameters:["pointer", "u32", "u32", "u32", "u32", "buffer"],
      result:"void",
    },
    bufferResize: {
      parameters:["pointer", "u32", "u32"],
      result:"void",
    },

    // Link API
    linkAlloc: {
      parameters:["buffer", "u32"],
      result:"u32",
    },
    linkGetUrl: {
      parameters:["u32", "buffer", "u32"],
      result:"u32",
    },
    attributesWithLink: {
      parameters:["u32", "u32"],
      result:"u32",
    },
    attributesGetLinkId: {
      parameters:["u32"],
      result:"u32",
    },

    resizeRenderer: {
      parameters:["pointer", "u32", "u32"],
      result:"void",
    },

    // Cursor functions (now renderer-scoped)
    setCursorPosition: {
      parameters:["pointer", "i32", "i32", "bool"],
      result:"void",
    },
    setCursorStyle: {
      parameters:["pointer", "buffer", "u32", "bool"],
      result:"void",
    },
    setCursorColor: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    getCursorState: {
      parameters:["pointer", "buffer"],
      result:"void",
    },

    // Debug overlay
    setDebugOverlay: {
      parameters:["pointer", "bool", "u8"],
      result:"void",
    },

    // Terminal control
    clearTerminal: {
      parameters:["pointer"],
      result:"void",
    },
    setTerminalTitle: {
      parameters:["pointer", "buffer", "usize"],
      result:"void",
    },
    copyToClipboardOSC52: {
      parameters:["pointer", "u8", "buffer", "usize"],
      result:"bool",
    },
    clearClipboardOSC52: {
      parameters:["pointer", "u8"],
      result:"bool",
    },

    bufferDrawSuperSampleBuffer: {
      parameters:["pointer", "u32", "u32", "pointer", "usize", "u8", "u32"],
      result:"void",
    },
    bufferDrawPackedBuffer: {
      parameters:["pointer", "pointer", "usize", "u32", "u32", "u32", "u32"],
      result:"void",
    },
    bufferDrawGrayscaleBuffer: {
      parameters:["pointer", "i32", "i32", "pointer", "u32", "u32", "buffer", "buffer"],
      result:"void",
    },
    bufferDrawGrayscaleBufferSupersampled: {
      parameters:["pointer", "i32", "i32", "pointer", "u32", "u32", "buffer", "buffer"],
      result:"void",
    },
    bufferDrawBox: {
      parameters:["pointer", "i32", "i32", "u32", "u32", "buffer", "u32", "buffer", "buffer", "buffer", "u32"],
      result:"void",
    },
    bufferPushScissorRect: {
      parameters:["pointer", "i32", "i32", "u32", "u32"],
      result:"void",
    },
    bufferPopScissorRect: {
      parameters:["pointer"],
      result:"void",
    },
    bufferClearScissorRects: {
      parameters:["pointer"],
      result:"void",
    },
    bufferPushOpacity: {
      parameters:["pointer", "f32"],
      result:"void",
    },
    bufferPopOpacity: {
      parameters:["pointer"],
      result:"void",
    },
    bufferGetCurrentOpacity: {
      parameters:["pointer"],
      result:"f32",
    },
    bufferClearOpacity: {
      parameters:["pointer"],
      result:"void",
    },

    addToHitGrid: {
      parameters:["pointer", "i32", "i32", "u32", "u32", "u32"],
      result:"void",
    },
    clearCurrentHitGrid: {
      parameters:["pointer"],
      result:"void",
    },
    hitGridPushScissorRect: {
      parameters:["pointer", "i32", "i32", "u32", "u32"],
      result:"void",
    },
    hitGridPopScissorRect: {
      parameters:["pointer"],
      result:"void",
    },
    hitGridClearScissorRects: {
      parameters:["pointer"],
      result:"void",
    },
    addToCurrentHitGridClipped: {
      parameters:["pointer", "i32", "i32", "u32", "u32", "u32"],
      result:"void",
    },
    checkHit: {
      parameters:["pointer", "u32", "u32"],
      result:"u32",
    },
    getHitGridDirty: {
      parameters:["pointer"],
      result:"bool",
    },
    dumpHitGrid: {
      parameters:["pointer"],
      result:"void",
    },
    dumpBuffers: {
      parameters:["pointer", "i64"],
      result:"void",
    },
    dumpStdoutBuffer: {
      parameters:["pointer", "i64"],
      result:"void",
    },
    restoreTerminalModes: {
      parameters:["pointer"],
      result:"void",
    },
    enableMouse: {
      parameters:["pointer", "bool"],
      result:"void",
    },
    disableMouse: {
      parameters:["pointer"],
      result:"void",
    },
    enableKittyKeyboard: {
      parameters:["pointer", "u8"],
      result:"void",
    },
    disableKittyKeyboard: {
      parameters:["pointer"],
      result:"void",
    },
    setKittyKeyboardFlags: {
      parameters:["pointer", "u8"],
      result:"void",
    },
    getKittyKeyboardFlags: {
      parameters:["pointer"],
      result:"u8",
    },
    setupTerminal: {
      parameters:["pointer", "bool"],
      result:"void",
    },
    suspendRenderer: {
      parameters:["pointer"],
      result:"void",
    },
    resumeRenderer: {
      parameters:["pointer"],
      result:"void",
    },
    writeOut: {
      parameters:["pointer", "buffer", "u64"],
      result:"void",
    },

    // TextBuffer functions
    createTextBuffer: {
      parameters:["u8"],
      result:"pointer",
    },
    destroyTextBuffer: {
      parameters:["pointer"],
      result:"void",
    },
    textBufferGetLength: {
      parameters:["pointer"],
      result:"u32",
    },
    textBufferGetByteSize: {
      parameters:["pointer"],
      result:"u32",
    },

    textBufferReset: {
      parameters:["pointer"],
      result:"void",
    },
    textBufferClear: {
      parameters:["pointer"],
      result:"void",
    },
    textBufferSetDefaultFg: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    textBufferSetDefaultBg: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    textBufferSetDefaultAttributes: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    textBufferResetDefaults: {
      parameters:["pointer"],
      result:"void",
    },
    textBufferGetTabWidth: {
      parameters:["pointer"],
      result:"u8",
    },
    textBufferSetTabWidth: {
      parameters:["pointer", "u8"],
      result:"void",
    },
    textBufferRegisterMemBuffer: {
      parameters:["pointer", "buffer", "usize", "bool"],
      result:"u16",
    },
    textBufferReplaceMemBuffer: {
      parameters:["pointer", "u8", "buffer", "usize", "bool"],
      result:"bool",
    },
    textBufferClearMemRegistry: {
      parameters:["pointer"],
      result:"void",
    },
    textBufferSetTextFromMem: {
      parameters:["pointer", "u8"],
      result:"void",
    },
    textBufferAppend: {
      parameters:["pointer", "buffer", "usize"],
      result:"void",
    },
    textBufferAppendFromMemId: {
      parameters:["pointer", "u8"],
      result:"void",
    },
    textBufferLoadFile: {
      parameters:["pointer", "buffer", "usize"],
      result:"bool",
    },
    textBufferSetStyledText: {
      parameters:["pointer", "buffer", "usize"],
      result:"void",
    },
    textBufferGetLineCount: {
      parameters:["pointer"],
      result:"u32",
    },
    textBufferGetPlainText: {
      parameters:["pointer", "buffer", "usize"],
      result:"usize",
    },
    textBufferAddHighlightByCharRange: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    textBufferAddHighlight: {
      parameters:["pointer", "u32", "buffer"],
      result:"void",
    },
    textBufferRemoveHighlightsByRef: {
      parameters:["pointer", "u16"],
      result:"void",
    },
    textBufferClearLineHighlights: {
      parameters:["pointer", "u32"],
      result:"void",
    },
    textBufferClearAllHighlights: {
      parameters:["pointer"],
      result:"void",
    },
    textBufferSetSyntaxStyle: {
      parameters:["pointer", "pointer"],
      result:"void",
    },
    textBufferGetLineHighlightsPtr: {
      parameters:["pointer", "u32", "buffer"],
      result:"pointer",
    },
    textBufferFreeLineHighlights: {
      parameters:["pointer", "usize"],
      result:"void",
    },
    textBufferGetHighlightCount: {
      parameters:["pointer"],
      result:"u32",
    },
    textBufferGetTextRange: {
      parameters:["pointer", "u32", "u32", "buffer", "usize"],
      result:"usize",
    },
    textBufferGetTextRangeByCoords: {
      parameters:["pointer", "u32", "u32", "u32", "u32", "buffer", "usize"],
      result:"usize",
    },

    // TextBufferView functions
    createTextBufferView: {
      parameters:["pointer"],
      result:"pointer",
    },
    destroyTextBufferView: {
      parameters:["pointer"],
      result:"void",
    },
    textBufferViewSetSelection: {
      parameters:["pointer", "u32", "u32", "buffer", "buffer"],
      result:"void",
    },
    textBufferViewResetSelection: {
      parameters:["pointer"],
      result:"void",
    },
    textBufferViewGetSelectionInfo: {
      parameters:["pointer"],
      result:"u64",
    },
    textBufferViewSetLocalSelection: {
      parameters:["pointer", "i32", "i32", "i32", "i32", "buffer", "buffer"],
      result:"bool",
    },
    textBufferViewUpdateSelection: {
      parameters:["pointer", "u32", "buffer", "buffer"],
      result:"void",
    },
    textBufferViewUpdateLocalSelection: {
      parameters:["pointer", "i32", "i32", "i32", "i32", "buffer", "buffer"],
      result:"bool",
    },
    textBufferViewResetLocalSelection: {
      parameters:["pointer"],
      result:"void",
    },
    textBufferViewSetWrapWidth: {
      parameters:["pointer", "u32"],
      result:"void",
    },
    textBufferViewSetWrapMode: {
      parameters:["pointer", "u8"],
      result:"void",
    },
    textBufferViewSetViewportSize: {
      parameters:["pointer", "u32", "u32"],
      result:"void",
    },
    textBufferViewSetViewport: {
      parameters:["pointer", "u32", "u32", "u32", "u32"],
      result:"void",
    },
    textBufferViewGetVirtualLineCount: {
      parameters:["pointer"],
      result:"u32",
    },
    textBufferViewGetLineInfoDirect: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    textBufferViewGetLogicalLineInfoDirect: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    textBufferViewGetSelectedText: {
      parameters:["pointer", "buffer", "usize"],
      result:"usize",
    },
    textBufferViewGetPlainText: {
      parameters:["pointer", "buffer", "usize"],
      result:"usize",
    },
    textBufferViewSetTabIndicator: {
      parameters:["pointer", "u32"],
      result:"void",
    },
    textBufferViewSetTabIndicatorColor: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    textBufferViewSetTruncate: {
      parameters:["pointer", "bool"],
      result:"void",
    },
    textBufferViewMeasureForDimensions: {
      parameters:["pointer", "u32", "u32", "buffer"],
      result:"bool",
    },
    bufferDrawTextBufferView: {
      parameters:["pointer", "pointer", "i32", "i32"],
      result:"void",
    },
    bufferDrawEditorView: {
      parameters:["pointer", "pointer", "i32", "i32"],
      result:"void",
    },

    // EditorView functions
    createEditorView: {
      parameters:["pointer", "u32", "u32"],
      result:"pointer",
    },
    destroyEditorView: {
      parameters:["pointer"],
      result:"void",
    },
    editorViewSetViewportSize: {
      parameters:["pointer", "u32", "u32"],
      result:"void",
    },
    editorViewSetViewport: {
      parameters:["pointer", "u32", "u32", "u32", "u32", "bool"],
      result:"void",
    },
    editorViewGetViewport: {
      parameters:["pointer", "buffer", "buffer", "buffer", "buffer"],
      result:"void",
    },
    editorViewSetScrollMargin: {
      parameters:["pointer", "f32"],
      result:"void",
    },
    editorViewSetWrapMode: {
      parameters:["pointer", "u8"],
      result:"void",
    },
    editorViewGetVirtualLineCount: {
      parameters:["pointer"],
      result:"u32",
    },
    editorViewGetTotalVirtualLineCount: {
      parameters:["pointer"],
      result:"u32",
    },
    editorViewGetTextBufferView: {
      parameters:["pointer"],
      result:"pointer",
    },
    editorViewGetLineInfoDirect: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editorViewGetLogicalLineInfoDirect: {
      parameters:["pointer", "buffer"],
      result:"void",
    },

    // EditBuffer functions
    createEditBuffer: {
      parameters:["u8"],
      result:"pointer",
    },
    destroyEditBuffer: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferSetText: {
      parameters:["pointer", "buffer", "usize"],
      result:"void",
    },
    editBufferSetTextFromMem: {
      parameters:["pointer", "u8"],
      result:"void",
    },
    editBufferReplaceText: {
      parameters:["pointer", "buffer", "usize"],
      result:"void",
    },
    editBufferReplaceTextFromMem: {
      parameters:["pointer", "u8"],
      result:"void",
    },
    editBufferGetText: {
      parameters:["pointer", "buffer", "usize"],
      result:"usize",
    },
    editBufferInsertChar: {
      parameters:["pointer", "buffer", "usize"],
      result:"void",
    },
    editBufferInsertText: {
      parameters:["pointer", "buffer", "usize"],
      result:"void",
    },
    editBufferDeleteChar: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferDeleteCharBackward: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferDeleteRange: {
      parameters:["pointer", "u32", "u32", "u32", "u32"],
      result:"void",
    },
    editBufferNewLine: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferDeleteLine: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferMoveCursorLeft: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferMoveCursorRight: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferMoveCursorUp: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferMoveCursorDown: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferGotoLine: {
      parameters:["pointer", "u32"],
      result:"void",
    },
    editBufferSetCursor: {
      parameters:["pointer", "u32", "u32"],
      result:"void",
    },
    editBufferSetCursorToLineCol: {
      parameters:["pointer", "u32", "u32"],
      result:"void",
    },
    editBufferSetCursorByOffset: {
      parameters:["pointer", "u32"],
      result:"void",
    },
    editBufferGetCursorPosition: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editBufferGetId: {
      parameters:["pointer"],
      result:"u16",
    },
    editBufferGetTextBuffer: {
      parameters:["pointer"],
      result:"pointer",
    },
    editBufferDebugLogRope: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferUndo: {
      parameters:["pointer", "buffer", "usize"],
      result:"usize",
    },
    editBufferRedo: {
      parameters:["pointer", "buffer", "usize"],
      result:"usize",
    },
    editBufferCanUndo: {
      parameters:["pointer"],
      result:"bool",
    },
    editBufferCanRedo: {
      parameters:["pointer"],
      result:"bool",
    },
    editBufferClearHistory: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferClear: {
      parameters:["pointer"],
      result:"void",
    },
    editBufferGetNextWordBoundary: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editBufferGetPrevWordBoundary: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editBufferGetEOL: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editBufferOffsetToPosition: {
      parameters:["pointer", "u32", "buffer"],
      result:"bool",
    },
    editBufferPositionToOffset: {
      parameters:["pointer", "u32", "u32"],
      result:"u32",
    },
    editBufferGetLineStartOffset: {
      parameters:["pointer", "u32"],
      result:"u32",
    },
    editBufferGetTextRange: {
      parameters:["pointer", "u32", "u32", "buffer", "usize"],
      result:"usize",
    },
    editBufferGetTextRangeByCoords: {
      parameters:["pointer", "u32", "u32", "u32", "u32", "buffer", "usize"],
      result:"usize",
    },

    // EditorView selection and editing methods
    editorViewSetSelection: {
      parameters:["pointer", "u32", "u32", "buffer", "buffer"],
      result:"void",
    },
    editorViewResetSelection: {
      parameters:["pointer"],
      result:"void",
    },
    editorViewGetSelection: {
      parameters:["pointer"],
      result:"u64",
    },
    editorViewSetLocalSelection: {
      parameters:["pointer", "i32", "i32", "i32", "i32", "buffer", "buffer", "bool", "bool"],
      result:"bool",
    },
    editorViewUpdateSelection: {
      parameters:["pointer", "u32", "buffer", "buffer"],
      result:"void",
    },
    editorViewUpdateLocalSelection: {
      parameters:["pointer", "i32", "i32", "i32", "i32", "buffer", "buffer", "bool", "bool"],
      result:"bool",
    },
    editorViewResetLocalSelection: {
      parameters:["pointer"],
      result:"void",
    },
    editorViewGetSelectedTextBytes: {
      parameters:["pointer", "buffer", "usize"],
      result:"usize",
    },
    editorViewGetCursor: {
      parameters:["pointer", "buffer", "buffer"],
      result:"void",
    },
    editorViewGetText: {
      parameters:["pointer", "buffer", "usize"],
      result:"usize",
    },

    // EditorView VisualCursor methods
    editorViewGetVisualCursor: {
      parameters:["pointer", "buffer"],
      result:"void",
    },

    editorViewMoveUpVisual: {
      parameters:["pointer"],
      result:"void",
    },
    editorViewMoveDownVisual: {
      parameters:["pointer"],
      result:"void",
    },
    editorViewDeleteSelectedText: {
      parameters:["pointer"],
      result:"void",
    },
    editorViewSetCursorByOffset: {
      parameters:["pointer", "u32"],
      result:"void",
    },
    editorViewGetNextWordBoundary: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editorViewGetPrevWordBoundary: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editorViewGetEOL: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editorViewGetVisualSOL: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editorViewGetVisualEOL: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    editorViewSetPlaceholderStyledText: {
      parameters:["pointer", "buffer", "usize"],
      result:"void",
    },
    editorViewSetTabIndicator: {
      parameters:["pointer", "u32"],
      result:"void",
    },
    editorViewSetTabIndicatorColor: {
      parameters:["pointer", "buffer"],
      result:"void",
    },

    getArenaAllocatedBytes: {
      parameters:[],
      result:"usize",
    },

    // SyntaxStyle functions
    createSyntaxStyle: {
      parameters:[],
      result:"pointer",
    },
    destroySyntaxStyle: {
      parameters:["pointer"],
      result:"void",
    },
    syntaxStyleRegister: {
      parameters:["pointer", "buffer", "usize", "buffer", "buffer", "u8"],
      result:"u32",
    },
    syntaxStyleResolveByName: {
      parameters:["pointer", "buffer", "usize"],
      result:"u32",
    },
    syntaxStyleGetStyleCount: {
      parameters:["pointer"],
      result:"usize",
    },

    // Terminal capability functions
    getTerminalCapabilities: {
      parameters:["pointer", "buffer"],
      result:"void",
    },
    processCapabilityResponse: {
      parameters:["pointer", "buffer", "usize"],
      result:"void",
    },

    // Unicode encoding API
    encodeUnicode: {
      parameters:["buffer", "usize", "buffer", "buffer", "u8"],
      result:"bool",
    },
    freeUnicode: {
      parameters:["pointer", "usize"],
      result:"void",
    },
    bufferDrawChar: {
      parameters:["pointer", "u32", "u32", "u32", "buffer", "buffer", "u32"],
      result:"void",
    },
  })

  // NativeSpanFeed symbols may not be present in older native library versions.
  // Load them separately so missing symbols don't prevent the rest of the library from working.
  const nativeSpanFeedDefs = {
    createNativeSpanFeed: {
      parameters:["buffer"] as const,
      result:"pointer" as const,
    },
    attachNativeSpanFeed: {
      parameters:["pointer"] as const,
      result:"i32" as const,
    },
    destroyNativeSpanFeed: {
      parameters:["pointer"] as const,
      result:"void" as const,
    },
    streamWrite: {
      parameters:["pointer", "buffer", "u64"] as const,
      result:"i32" as const,
    },
    streamCommit: {
      parameters:["pointer"] as const,
      result:"i32" as const,
    },
    streamDrainSpans: {
      parameters:["pointer", "buffer", "u32"] as const,
      result:"u32" as const,
    },
    streamClose: {
      parameters:["pointer"] as const,
      result:"i32" as const,
    },
    streamReserve: {
      parameters:["pointer", "u32", "buffer"] as const,
      result:"i32" as const,
    },
    streamCommitReserved: {
      parameters:["pointer", "u32"] as const,
      result:"i32" as const,
    },
    streamSetOptions: {
      parameters:["pointer", "buffer"] as const,
      result:"i32" as const,
    },
    streamGetStats: {
      parameters:["pointer", "buffer"] as const,
      result:"i32" as const,
    },
    streamSetCallback: {
      parameters:["pointer", "pointer"] as const,
      result:"void" as const,
    },
  }

  let optionalSymbols: Record<string, any> = {}
  try {
    const optionalLib = Deno.dlopen(resolvedLibPath, nativeSpanFeedDefs)
    optionalSymbols = optionalLib.symbols
  } catch {
    // NativeSpanFeed symbols not available in this version of the native library
  }

  const allSymbols = { ...rawSymbols.symbols, ...optionalSymbols }

  if (env.OTUI_DEBUG_FFI || env.OTUI_TRACE_FFI) {
    return {
      symbols: convertToDebugSymbols(allSymbols),
    }
  }

  return { symbols: allSymbols }
}

function convertToDebugSymbols<T extends Record<string, any>>(symbols: T): T {
  // Initialize global state on first call
  if (!globalTraceSymbols) {
    globalTraceSymbols = {}
  }

  // Initialize global debug log file on first call
  if (env.OTUI_DEBUG_FFI && !globalFFILogFile) {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, "-").replace(/T/, "_").split("Z")[0]
    const logFilePath = `ffi_otui_debug_${timestamp}.log`
    globalFFILogFile = Deno.openSync(logFilePath, { write: true, create: true })
  }

  const debugSymbols: Record<string, any> = {}
  let hasTracing = false

  Object.entries(symbols).forEach(([key, value]) => {
    debugSymbols[key] = value
  })

  if (env.OTUI_DEBUG_FFI && globalFFILogFile) {
    const file = globalFFILogFile
    const writeSync = (msg: string) => {
      const buffer = new TextEncoder().encode(msg + "\n")
      file.writeSync(buffer)
    }

    Object.entries(symbols).forEach(([key, value]) => {
      if (typeof value === "function") {
        debugSymbols[key] = (...args: any[]) => {
          writeSync(`${key}(${args.map((arg) => String(arg)).join(", ")})`)
          const result = value(...args)
          writeSync(`${key} returned: ${String(result)}`)
          return result
        }
      }
    })
  }

  if (env.OTUI_TRACE_FFI) {
    hasTracing = true
    Object.entries(symbols).forEach(([key, value]) => {
      if (typeof value === "function") {
        // Initialize trace array for this symbol if not exists
        if (!globalTraceSymbols![key]) {
          globalTraceSymbols![key] = []
        }

        const originalFunc = debugSymbols[key]
        debugSymbols[key] = (...args: any[]) => {
          const start = performance.now()
          const result = originalFunc(...args)
          const end = performance.now()
          globalTraceSymbols![key].push(end - start)
          return result
        }
      }
    })
  }

  // Register exit handler only once
  if ((env.OTUI_DEBUG_FFI || env.OTUI_TRACE_FFI) && !exitHandlerRegistered) {
    exitHandlerRegistered = true

    process.on("exit", () => {
      try {
        if (globalFFILogFile) {
          globalFFILogFile.close()
        }
      } catch (e) {
        // Ignore errors on exit
      }

      if (globalTraceSymbols) {
        const allStats: Array<{
          name: string
          count: number
          total: number
          average: number
          min: number
          max: number
          median: number
          p90: number
          p99: number
        }> = []

        for (const [key, timings] of Object.entries(globalTraceSymbols)) {
          if (!Array.isArray(timings) || timings.length === 0) {
            continue
          }

          const sortedTimings = [...timings].sort((a, b) => a - b)
          const count = sortedTimings.length

          const total = sortedTimings.reduce((acc, t) => acc + t, 0)
          const average = total / count
          const min = sortedTimings[0]
          const max = sortedTimings[count - 1]

          const medianIndex = Math.floor(count / 2)
          const p90Index = Math.floor(count * 0.9)
          const p99Index = Math.floor(count * 0.99)

          const median = sortedTimings[medianIndex]
          const p90 = sortedTimings[Math.min(p90Index, count - 1)]
          const p99 = sortedTimings[Math.min(p99Index, count - 1)]

          allStats.push({
            name: key,
            count,
            total,
            average,
            min,
            max,
            median,
            p90,
            p99,
          })
        }

        allStats.sort((a, b) => b.total - a.total)

        const lines: string[] = []
        lines.push("\n--- OpenTUI FFI Call Performance ---")
        lines.push("Sorted by total time spent (descending)")
        lines.push(
          "-------------------------------------------------------------------------------------------------------------------------",
        )

        if (allStats.length === 0) {
          lines.push("No trace data collected or all symbols had zero calls.")
        } else {
          const nameHeader = "Symbol"
          const callsHeader = "Calls"
          const totalHeader = "Total (ms)"
          const avgHeader = "Avg (ms)"
          const minHeader = "Min (ms)"
          const maxHeader = "Max (ms)"
          const medHeader = "Med (ms)"
          const p90Header = "P90 (ms)"
          const p99Header = "P99 (ms)"

          const nameWidth = Math.max(nameHeader.length, ...allStats.map((s) => s.name.length))
          const countWidth = Math.max(callsHeader.length, ...allStats.map((s) => String(s.count).length))
          const totalWidth = Math.max(totalHeader.length, ...allStats.map((s) => s.total.toFixed(2).length))
          const avgWidth = Math.max(avgHeader.length, ...allStats.map((s) => s.average.toFixed(2).length))
          const minWidth = Math.max(minHeader.length, ...allStats.map((s) => s.min.toFixed(2).length))
          const maxWidth = Math.max(maxHeader.length, ...allStats.map((s) => s.max.toFixed(2).length))
          const medianWidth = Math.max(medHeader.length, ...allStats.map((s) => s.median.toFixed(2).length))
          const p90Width = Math.max(p90Header.length, ...allStats.map((s) => s.p90.toFixed(2).length))
          const p99Width = Math.max(p99Header.length, ...allStats.map((s) => s.p99.toFixed(2).length))

          lines.push(
            `${nameHeader.padEnd(nameWidth)} | ` +
              `${callsHeader.padStart(countWidth)} | ` +
              `${totalHeader.padStart(totalWidth)} | ` +
              `${avgHeader.padStart(avgWidth)} | ` +
              `${minHeader.padStart(minWidth)} | ` +
              `${maxHeader.padStart(maxWidth)} | ` +
              `${medHeader.padStart(medianWidth)} | ` +
              `${p90Header.padStart(p90Width)} | ` +
              `${p99Header.padStart(p99Width)}`,
          )
          lines.push(
            `${"-".repeat(nameWidth)}-+-${"-".repeat(countWidth)}-+-${"-".repeat(totalWidth)}-+-${"-".repeat(avgWidth)}-+-${"-".repeat(minWidth)}-+-${"-".repeat(maxWidth)}-+-${"-".repeat(medianWidth)}-+-${"-".repeat(p90Width)}-+-${"-".repeat(p99Width)}`,
          )

          allStats.forEach((stat) => {
            lines.push(
              `${stat.name.padEnd(nameWidth)} | ` +
                `${String(stat.count).padStart(countWidth)} | ` +
                `${stat.total.toFixed(2).padStart(totalWidth)} | ` +
                `${stat.average.toFixed(2).padStart(avgWidth)} | ` +
                `${stat.min.toFixed(2).padStart(minWidth)} | ` +
                `${stat.max.toFixed(2).padStart(maxWidth)} | ` +
                `${stat.median.toFixed(2).padStart(medianWidth)} | ` +
                `${stat.p90.toFixed(2).padStart(p90Width)} | ` +
                `${stat.p99.toFixed(2).padStart(p99Width)}`,
            )
          })
        }
        lines.push(
          "-------------------------------------------------------------------------------------------------------------------------",
        )

        const output = lines.join("\n")
        console.log(output)

        try {
          const now = new Date()
          const timestamp = now.toISOString().replace(/[:.]/g, "-").replace(/T/, "_").split("Z")[0]
          const traceFilePath = `ffi_otui_trace_${timestamp}.log`
          Deno.writeTextFileSync(traceFilePath, output)
        } catch (e) {
          console.error("Failed to write FFI trace file:", e)
        }
      }
    })
  }

  return debugSymbols as T
}

// Log levels matching Zig's LogLevel enum
export enum LogLevel {
  Error = 0,
  Warn = 1,
  Info = 2,
  Debug = 3,
}

/**
 * VisualCursor represents a cursor position with both visual and logical coordinates.
 * Visual coordinates (visualRow, visualCol) are VIEWPORT-RELATIVE.
 * This means visualRow=0 is the first visible line in the viewport, not the first line in the document.
 * Logical coordinates (logicalRow, logicalCol) are document-absolute.
 */
export interface VisualCursor {
  visualRow: number // Viewport-relative row (0 = top of viewport)
  visualCol: number // Viewport-relative column (0 = left edge of viewport when not wrapping)
  logicalRow: number // Document-absolute row
  logicalCol: number // Document-absolute column
  offset: number // Global display-width offset from buffer start
}

export interface LogicalCursor {
  row: number
  col: number
  offset: number
}

export interface CursorState {
  x: number
  y: number
  visible: boolean
  style: CursorStyle
  blinking: boolean
  color: RGBA
}

export type NativeSpanFeedEventHandler = (eventId: number, arg0: Pointer, arg1: number | bigint) => void

export interface RenderLib {
  createRenderer: (width: number, height: number, options?: { testing?: boolean; remote?: boolean }) => Pointer | null
  destroyRenderer: (renderer: Pointer) => void
  setUseThread: (renderer: Pointer, useThread: boolean) => void
  setBackgroundColor: (renderer: Pointer, color: RGBA) => void
  setRenderOffset: (renderer: Pointer, offset: number) => void
  updateStats: (renderer: Pointer, time: number, fps: number, frameCallbackTime: number) => void
  updateMemoryStats: (renderer: Pointer, heapUsed: number, heapTotal: number, arrayBuffers: number) => void
  render: (renderer: Pointer, force: boolean) => void
  getNextBuffer: (renderer: Pointer) => OptimizedBuffer
  getCurrentBuffer: (renderer: Pointer) => OptimizedBuffer
  createOptimizedBuffer: (
    width: number,
    height: number,
    widthMethod: WidthMethod,
    respectAlpha?: boolean,
    id?: string,
  ) => OptimizedBuffer
  destroyOptimizedBuffer: (bufferPtr: Pointer) => void
  drawFrameBuffer: (
    targetBufferPtr: Pointer,
    destX: number,
    destY: number,
    bufferPtr: Pointer,
    sourceX?: number,
    sourceY?: number,
    sourceWidth?: number,
    sourceHeight?: number,
  ) => void
  getBufferWidth: (buffer: Pointer) => number
  getBufferHeight: (buffer: Pointer) => number
  bufferClear: (buffer: Pointer, color: RGBA) => void
  bufferGetCharPtr: (buffer: Pointer) => Pointer
  bufferGetFgPtr: (buffer: Pointer) => Pointer
  bufferGetBgPtr: (buffer: Pointer) => Pointer
  bufferGetAttributesPtr: (buffer: Pointer) => Pointer
  bufferGetRespectAlpha: (buffer: Pointer) => boolean
  bufferSetRespectAlpha: (buffer: Pointer, respectAlpha: boolean) => void
  bufferGetId: (buffer: Pointer) => string
  bufferGetRealCharSize: (buffer: Pointer) => number
  bufferWriteResolvedChars: (buffer: Pointer, outputBuffer: Uint8Array, addLineBreaks: boolean) => number
  bufferDrawText: (
    buffer: Pointer,
    text: string,
    x: number,
    y: number,
    color: RGBA,
    bgColor?: RGBA,
    attributes?: number,
  ) => void
  bufferSetCellWithAlphaBlending: (
    buffer: Pointer,
    x: number,
    y: number,
    char: string,
    color: RGBA,
    bgColor: RGBA,
    attributes?: number,
  ) => void
  bufferSetCell: (
    buffer: Pointer,
    x: number,
    y: number,
    char: string,
    color: RGBA,
    bgColor: RGBA,
    attributes?: number,
  ) => void
  bufferFillRect: (buffer: Pointer, x: number, y: number, width: number, height: number, color: RGBA) => void
  bufferDrawSuperSampleBuffer: (
    buffer: Pointer,
    x: number,
    y: number,
    pixelDataPtr: Pointer,
    pixelDataLength: number,
    format: "bgra8unorm" | "rgba8unorm",
    alignedBytesPerRow: number,
  ) => void
  bufferDrawPackedBuffer: (
    buffer: Pointer,
    dataPtr: Pointer,
    dataLen: number,
    posX: number,
    posY: number,
    terminalWidthCells: number,
    terminalHeightCells: number,
  ) => void
  bufferDrawGrayscaleBuffer: (
    buffer: Pointer,
    posX: number,
    posY: number,
    intensitiesPtr: Pointer,
    srcWidth: number,
    srcHeight: number,
    fg: RGBA | null,
    bg: RGBA | null,
  ) => void
  bufferDrawGrayscaleBufferSupersampled: (
    buffer: Pointer,
    posX: number,
    posY: number,
    intensitiesPtr: Pointer,
    srcWidth: number,
    srcHeight: number,
    fg: RGBA | null,
    bg: RGBA | null,
  ) => void
  bufferDrawBox: (
    buffer: Pointer,
    x: number,
    y: number,
    width: number,
    height: number,
    borderChars: Uint32Array,
    packedOptions: number,
    borderColor: RGBA,
    backgroundColor: RGBA,
    title: string | null,
  ) => void
  bufferResize: (buffer: Pointer, width: number, height: number) => void
  resizeRenderer: (renderer: Pointer, width: number, height: number) => void
  setCursorPosition: (renderer: Pointer, x: number, y: number, visible: boolean) => void
  setCursorStyle: (renderer: Pointer, style: CursorStyle, blinking: boolean) => void
  setCursorColor: (renderer: Pointer, color: RGBA) => void
  getCursorState: (renderer: Pointer) => CursorState
  setDebugOverlay: (renderer: Pointer, enabled: boolean, corner: DebugOverlayCorner) => void
  clearTerminal: (renderer: Pointer) => void
  setTerminalTitle: (renderer: Pointer, title: string) => void
  copyToClipboardOSC52: (renderer: Pointer, target: number, payload: Uint8Array) => boolean
  clearClipboardOSC52: (renderer: Pointer, target: number) => boolean
  addToHitGrid: (renderer: Pointer, x: number, y: number, width: number, height: number, id: number) => void
  clearCurrentHitGrid: (renderer: Pointer) => void
  hitGridPushScissorRect: (renderer: Pointer, x: number, y: number, width: number, height: number) => void
  hitGridPopScissorRect: (renderer: Pointer) => void
  hitGridClearScissorRects: (renderer: Pointer) => void
  addToCurrentHitGridClipped: (
    renderer: Pointer,
    x: number,
    y: number,
    width: number,
    height: number,
    id: number,
  ) => void
  checkHit: (renderer: Pointer, x: number, y: number) => number
  getHitGridDirty: (renderer: Pointer) => boolean
  dumpHitGrid: (renderer: Pointer) => void
  dumpBuffers: (renderer: Pointer, timestamp?: number) => void
  dumpStdoutBuffer: (renderer: Pointer, timestamp?: number) => void
  restoreTerminalModes: (renderer: Pointer) => void
  enableMouse: (renderer: Pointer, enableMovement: boolean) => void
  disableMouse: (renderer: Pointer) => void
  enableKittyKeyboard: (renderer: Pointer, flags: number) => void
  disableKittyKeyboard: (renderer: Pointer) => void
  setKittyKeyboardFlags: (renderer: Pointer, flags: number) => void
  getKittyKeyboardFlags: (renderer: Pointer) => number
  setupTerminal: (renderer: Pointer, useAlternateScreen: boolean) => void
  suspendRenderer: (renderer: Pointer) => void
  resumeRenderer: (renderer: Pointer) => void
  queryPixelResolution: (renderer: Pointer) => void
  writeOut: (renderer: Pointer, data: string | Uint8Array) => void

  // TextBuffer methods
  createTextBuffer: (widthMethod: WidthMethod) => TextBuffer
  destroyTextBuffer: (buffer: Pointer) => void
  textBufferGetLength: (buffer: Pointer) => number
  textBufferGetByteSize: (buffer: Pointer) => number

  textBufferReset: (buffer: Pointer) => void
  textBufferClear: (buffer: Pointer) => void
  textBufferRegisterMemBuffer: (buffer: Pointer, bytes: Uint8Array, owned?: boolean) => number
  textBufferReplaceMemBuffer: (buffer: Pointer, memId: number, bytes: Uint8Array, owned?: boolean) => boolean
  textBufferClearMemRegistry: (buffer: Pointer) => void
  textBufferSetTextFromMem: (buffer: Pointer, memId: number) => void
  textBufferAppend: (buffer: Pointer, bytes: Uint8Array) => void
  textBufferAppendFromMemId: (buffer: Pointer, memId: number) => void
  textBufferLoadFile: (buffer: Pointer, path: string) => boolean
  textBufferSetStyledText: (
    buffer: Pointer,
    chunks: Array<{ text: string; fg?: RGBA | null; bg?: RGBA | null; attributes?: number; link?: { url: string } }>,
  ) => void
  textBufferSetDefaultFg: (buffer: Pointer, fg: RGBA | null) => void
  textBufferSetDefaultBg: (buffer: Pointer, bg: RGBA | null) => void
  textBufferSetDefaultAttributes: (buffer: Pointer, attributes: number | null) => void
  textBufferResetDefaults: (buffer: Pointer) => void
  textBufferGetTabWidth: (buffer: Pointer) => number
  textBufferSetTabWidth: (buffer: Pointer, width: number) => void
  textBufferGetLineCount: (buffer: Pointer) => number
  getPlainTextBytes: (buffer: Pointer, maxLength: number) => Uint8Array | null
  textBufferGetTextRange: (
    buffer: Pointer,
    startOffset: number,
    endOffset: number,
    maxLength: number,
  ) => Uint8Array | null
  textBufferGetTextRangeByCoords: (
    buffer: Pointer,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    maxLength: number,
  ) => Uint8Array | null

  // TextBufferView methods
  createTextBufferView: (textBuffer: Pointer) => Pointer
  destroyTextBufferView: (view: Pointer) => void
  textBufferViewSetSelection: (
    view: Pointer,
    start: number,
    end: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ) => void
  textBufferViewResetSelection: (view: Pointer) => void
  textBufferViewGetSelection: (view: Pointer) => { start: number; end: number } | null
  textBufferViewSetLocalSelection: (
    view: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ) => boolean
  textBufferViewUpdateSelection: (view: Pointer, end: number, bgColor: RGBA | null, fgColor: RGBA | null) => void
  textBufferViewUpdateLocalSelection: (
    view: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ) => boolean
  textBufferViewResetLocalSelection: (view: Pointer) => void
  textBufferViewSetWrapWidth: (view: Pointer, width: number) => void
  textBufferViewSetWrapMode: (view: Pointer, mode: "none" | "char" | "word") => void
  textBufferViewSetViewportSize: (view: Pointer, width: number, height: number) => void
  textBufferViewSetViewport: (view: Pointer, x: number, y: number, width: number, height: number) => void
  textBufferViewGetLineInfo: (view: Pointer) => LineInfo
  textBufferViewGetLogicalLineInfo: (view: Pointer) => LineInfo
  textBufferViewGetSelectedTextBytes: (view: Pointer, maxLength: number) => Uint8Array | null
  textBufferViewGetPlainTextBytes: (view: Pointer, maxLength: number) => Uint8Array | null
  textBufferViewSetTabIndicator: (view: Pointer, indicator: number) => void
  textBufferViewSetTabIndicatorColor: (view: Pointer, color: RGBA) => void
  textBufferViewSetTruncate: (view: Pointer, truncate: boolean) => void
  textBufferViewMeasureForDimensions: (
    view: Pointer,
    width: number,
    height: number,
  ) => { lineCount: number; maxWidth: number } | null
  textBufferViewGetVirtualLineCount: (view: Pointer) => number

  readonly encoder: TextEncoder
  readonly decoder: TextDecoder
  bufferDrawTextBufferView: (buffer: Pointer, view: Pointer, x: number, y: number) => void
  bufferDrawEditorView: (buffer: Pointer, view: Pointer, x: number, y: number) => void

  // EditBuffer methods
  createEditBuffer: (widthMethod: WidthMethod) => Pointer
  destroyEditBuffer: (buffer: Pointer) => void
  editBufferSetText: (buffer: Pointer, textBytes: Uint8Array) => void
  editBufferSetTextFromMem: (buffer: Pointer, memId: number) => void
  editBufferReplaceText: (buffer: Pointer, textBytes: Uint8Array) => void
  editBufferReplaceTextFromMem: (buffer: Pointer, memId: number) => void
  editBufferGetText: (buffer: Pointer, maxLength: number) => Uint8Array | null
  editBufferInsertChar: (buffer: Pointer, char: string) => void
  editBufferInsertText: (buffer: Pointer, text: string) => void
  editBufferDeleteChar: (buffer: Pointer) => void
  editBufferDeleteCharBackward: (buffer: Pointer) => void
  editBufferDeleteRange: (buffer: Pointer, startLine: number, startCol: number, endLine: number, endCol: number) => void
  editBufferNewLine: (buffer: Pointer) => void
  editBufferDeleteLine: (buffer: Pointer) => void
  editBufferMoveCursorLeft: (buffer: Pointer) => void
  editBufferMoveCursorRight: (buffer: Pointer) => void
  editBufferMoveCursorUp: (buffer: Pointer) => void
  editBufferMoveCursorDown: (buffer: Pointer) => void
  editBufferGotoLine: (buffer: Pointer, line: number) => void
  editBufferSetCursor: (buffer: Pointer, line: number, col: number) => void
  editBufferSetCursorToLineCol: (buffer: Pointer, line: number, col: number) => void
  editBufferSetCursorByOffset: (buffer: Pointer, offset: number) => void
  editBufferGetCursorPosition: (buffer: Pointer) => LogicalCursor
  editBufferGetId: (buffer: Pointer) => number
  editBufferGetTextBuffer: (buffer: Pointer) => Pointer
  editBufferDebugLogRope: (buffer: Pointer) => void
  editBufferUndo: (buffer: Pointer, maxLength: number) => Uint8Array | null
  editBufferRedo: (buffer: Pointer, maxLength: number) => Uint8Array | null
  editBufferCanUndo: (buffer: Pointer) => boolean
  editBufferCanRedo: (buffer: Pointer) => boolean
  editBufferClearHistory: (buffer: Pointer) => void
  editBufferClear: (buffer: Pointer) => void
  editBufferGetNextWordBoundary: (buffer: Pointer) => { row: number; col: number; offset: number }
  editBufferGetPrevWordBoundary: (buffer: Pointer) => { row: number; col: number; offset: number }
  editBufferGetEOL: (buffer: Pointer) => { row: number; col: number; offset: number }
  editBufferOffsetToPosition: (buffer: Pointer, offset: number) => { row: number; col: number; offset: number } | null
  editBufferPositionToOffset: (buffer: Pointer, row: number, col: number) => number
  editBufferGetLineStartOffset: (buffer: Pointer, row: number) => number
  editBufferGetTextRange: (
    buffer: Pointer,
    startOffset: number,
    endOffset: number,
    maxLength: number,
  ) => Uint8Array | null
  editBufferGetTextRangeByCoords: (
    buffer: Pointer,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    maxLength: number,
  ) => Uint8Array | null

  // EditorView methods
  createEditorView: (editBufferPtr: Pointer, viewportWidth: number, viewportHeight: number) => Pointer
  destroyEditorView: (view: Pointer) => void
  editorViewSetViewportSize: (view: Pointer, width: number, height: number) => void
  editorViewSetViewport: (
    view: Pointer,
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor: boolean,
  ) => void
  editorViewGetViewport: (view: Pointer) => { offsetY: number; offsetX: number; height: number; width: number }
  editorViewSetScrollMargin: (view: Pointer, margin: number) => void
  editorViewSetWrapMode: (view: Pointer, mode: "none" | "char" | "word") => void
  editorViewGetVirtualLineCount: (view: Pointer) => number
  editorViewGetTotalVirtualLineCount: (view: Pointer) => number
  editorViewGetTextBufferView: (view: Pointer) => Pointer
  editorViewSetSelection: (
    view: Pointer,
    start: number,
    end: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ) => void
  editorViewResetSelection: (view: Pointer) => void
  editorViewGetSelection: (view: Pointer) => { start: number; end: number } | null
  editorViewSetLocalSelection: (
    view: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
    updateCursor: boolean,
    followCursor: boolean,
  ) => boolean

  editorViewUpdateSelection: (view: Pointer, end: number, bgColor: RGBA | null, fgColor: RGBA | null) => void
  editorViewUpdateLocalSelection: (
    view: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
    updateCursor: boolean,
    followCursor: boolean,
  ) => boolean

  editorViewResetLocalSelection: (view: Pointer) => void
  editorViewGetSelectedTextBytes: (view: Pointer, maxLength: number) => Uint8Array | null
  editorViewGetCursor: (view: Pointer) => { row: number; col: number }
  editorViewGetText: (view: Pointer, maxLength: number) => Uint8Array | null
  editorViewGetVisualCursor: (view: Pointer) => VisualCursor
  editorViewMoveUpVisual: (view: Pointer) => void
  editorViewMoveDownVisual: (view: Pointer) => void
  editorViewDeleteSelectedText: (view: Pointer) => void
  editorViewSetCursorByOffset: (view: Pointer, offset: number) => void
  editorViewGetNextWordBoundary: (view: Pointer) => VisualCursor
  editorViewGetPrevWordBoundary: (view: Pointer) => VisualCursor
  editorViewGetEOL: (view: Pointer) => VisualCursor
  editorViewGetVisualSOL: (view: Pointer) => VisualCursor
  editorViewGetVisualEOL: (view: Pointer) => VisualCursor
  editorViewGetLineInfo: (view: Pointer) => LineInfo
  editorViewGetLogicalLineInfo: (view: Pointer) => LineInfo
  editorViewSetPlaceholderStyledText: (
    view: Pointer,
    chunks: Array<{ text: string; fg?: RGBA | null; bg?: RGBA | null; attributes?: number }>,
  ) => void
  editorViewSetTabIndicator: (view: Pointer, indicator: number) => void
  editorViewSetTabIndicatorColor: (view: Pointer, color: RGBA) => void

  bufferPushScissorRect: (buffer: Pointer, x: number, y: number, width: number, height: number) => void
  bufferPopScissorRect: (buffer: Pointer) => void
  bufferClearScissorRects: (buffer: Pointer) => void
  bufferPushOpacity: (buffer: Pointer, opacity: number) => void
  bufferPopOpacity: (buffer: Pointer) => void
  bufferGetCurrentOpacity: (buffer: Pointer) => number
  bufferClearOpacity: (buffer: Pointer) => void
  textBufferAddHighlightByCharRange: (buffer: Pointer, highlight: Highlight) => void
  textBufferAddHighlight: (buffer: Pointer, lineIdx: number, highlight: Highlight) => void
  textBufferRemoveHighlightsByRef: (buffer: Pointer, hlRef: number) => void
  textBufferClearLineHighlights: (buffer: Pointer, lineIdx: number) => void
  textBufferClearAllHighlights: (buffer: Pointer) => void
  textBufferSetSyntaxStyle: (buffer: Pointer, style: Pointer | null) => void
  textBufferGetLineHighlights: (buffer: Pointer, lineIdx: number) => Array<Highlight>
  textBufferGetHighlightCount: (buffer: Pointer) => number

  getArenaAllocatedBytes: () => number

  createSyntaxStyle: () => Pointer
  destroySyntaxStyle: (style: Pointer) => void
  syntaxStyleRegister: (style: Pointer, name: string, fg: RGBA | null, bg: RGBA | null, attributes: number) => number
  syntaxStyleResolveByName: (style: Pointer, name: string) => number | null
  syntaxStyleGetStyleCount: (style: Pointer) => number

  getTerminalCapabilities: (renderer: Pointer) => any
  processCapabilityResponse: (renderer: Pointer, response: string) => void

  encodeUnicode: (
    text: string,
    widthMethod: WidthMethod,
  ) => { ptr: Pointer; data: Array<{ width: number; char: number }> } | null
  freeUnicode: (encoded: { ptr: Pointer; data: Array<{ width: number; char: number }> }) => void
  bufferDrawChar: (buffer: Pointer, char: number, x: number, y: number, fg: RGBA, bg: RGBA, attributes?: number) => void

  registerNativeSpanFeedStream: (stream: Pointer, handler: NativeSpanFeedEventHandler) => void
  unregisterNativeSpanFeedStream: (stream: Pointer) => void
  createNativeSpanFeed: (options?: NativeSpanFeedOptions | null) => Pointer
  attachNativeSpanFeed: (stream: Pointer) => number
  destroyNativeSpanFeed: (stream: Pointer) => void
  streamWrite: (stream: Pointer, data: Uint8Array | string) => number
  streamCommit: (stream: Pointer) => number
  streamDrainSpans: (stream: Pointer, outBuffer: Uint8Array, maxSpans: number) => number
  streamClose: (stream: Pointer) => number
  streamSetOptions: (stream: Pointer, options: NativeSpanFeedOptions) => number
  streamGetStats: (stream: Pointer) => NativeSpanFeedStats | null
  streamReserve: (stream: Pointer, minLen: number) => { status: number; info: ReserveInfo | null }
  streamCommitReserved: (stream: Pointer, length: number) => number

  onNativeEvent: (name: string, handler: (data: ArrayBuffer) => void) => void
  onceNativeEvent: (name: string, handler: (data: ArrayBuffer) => void) => void
  offNativeEvent: (name: string, handler: (data: ArrayBuffer) => void) => void
  onAnyNativeEvent: (handler: (name: string, data: ArrayBuffer) => void) => void
}

class FFIRenderLib implements RenderLib {
  private opentui: ReturnType<typeof getOpenTUILib>
  public readonly encoder: TextEncoder = new TextEncoder()
  public readonly decoder: TextDecoder = new TextDecoder()
  private logCallbackWrapper: any // Store the FFI callback wrapper
  private eventCallbackWrapper: any // Store the FFI event callback wrapper
  private _nativeEvents: EventEmitter = new EventEmitter()
  private _anyEventHandlers: Array<(name: string, data: ArrayBuffer) => void> = []
  private nativeSpanFeedCallbackWrapper: Deno.UnsafeCallback | null = null
  private nativeSpanFeedHandlers = new Map<bigint, NativeSpanFeedEventHandler>()

  constructor(libPath?: string) {
    this.opentui = getOpenTUILib(libPath)
    this.setupLogging()
    this.setupEventBus()
  }

  private setupLogging() {
    if (this.logCallbackWrapper) {
      return
    }

    const logCallback = new Deno.UnsafeCallback(
      {
        parameters: ["u8", "pointer", "usize"],
        result: "void",
      } as const,
      (level: number, msgPtr: Deno.PointerValue, msgLenBigInt: number | bigint) => {
        try {
          const msgLen = typeof msgLenBigInt === "bigint" ? Number(msgLenBigInt) : msgLenBigInt

          if (msgLen === 0 || !msgPtr) {
            return
          }

          const msgBuffer = Deno.UnsafePointerView.getArrayBuffer(msgPtr, msgLen)
          const msgBytes = new Uint8Array(msgBuffer)
          const message = this.decoder.decode(msgBytes)

          switch (level) {
            case LogLevel.Error:
              console.error(message)
              break
            case LogLevel.Warn:
              console.warn(message)
              break
            case LogLevel.Info:
              console.info(message)
              break
            case LogLevel.Debug:
              console.debug(message)
              break
            default:
              console.log(message)
          }
        } catch (error) {
          console.error("Error in Zig log callback:", error)
        }
      },
    )

    this.logCallbackWrapper = logCallback

    if (!logCallback.pointer) {
      throw new Error("Failed to create log callback")
    }

    this.setLogCallback(logCallback.pointer)
  }

  private setLogCallback(callbackPtr: Pointer) {
    this.opentui.symbols.setLogCallback(callbackPtr)
  }

  private setupEventBus() {
    if (this.eventCallbackWrapper) {
      return
    }

    const eventCallback = new Deno.UnsafeCallback(
      {
        parameters: ["pointer", "usize", "pointer", "usize"],
        result: "void",
      } as const,
      (namePtr: Deno.PointerValue, nameLenBigInt: number | bigint, dataPtr: Deno.PointerValue, dataLenBigInt: number | bigint) => {
        try {
          const nameLen = typeof nameLenBigInt === "bigint" ? Number(nameLenBigInt) : nameLenBigInt
          const dataLen = typeof dataLenBigInt === "bigint" ? Number(dataLenBigInt) : dataLenBigInt

          if (nameLen === 0 || !namePtr) {
            return
          }

          const nameBuffer = Deno.UnsafePointerView.getArrayBuffer(namePtr, nameLen)
          const nameBytes = new Uint8Array(nameBuffer)
          const eventName = this.decoder.decode(nameBytes)

          let eventData: ArrayBuffer
          if (dataLen > 0 && dataPtr) {
            eventData = Deno.UnsafePointerView.getArrayBuffer(dataPtr, dataLen).slice(0)
          } else {
            eventData = new ArrayBuffer(0)
          }

          queueMicrotask(() => {
            this._nativeEvents.emit(eventName, eventData)

            for (const handler of this._anyEventHandlers) {
              handler(eventName, eventData)
            }
          })
        } catch (error) {
          console.error("Error in native event callback:", error)
        }
      },
    )

    this.eventCallbackWrapper = eventCallback

    if (!eventCallback.pointer) {
      throw new Error("Failed to create event callback")
    }

    this.setEventCallback(eventCallback.pointer)
  }

  private ensureNativeSpanFeedCallback(): Deno.UnsafeCallback {
    if (this.nativeSpanFeedCallbackWrapper) {
      return this.nativeSpanFeedCallbackWrapper
    }

    const callback = new Deno.UnsafeCallback(
      {
        parameters: ["pointer", "u32", "pointer", "u64"],
        result: "void",
      } as const,
      (streamPtr: Deno.PointerValue, eventId: number, arg0: Deno.PointerValue, arg1: number | bigint) => {
        const handler = this.nativeSpanFeedHandlers.get(Deno.UnsafePointer.value(streamPtr!))
        if (handler) {
          handler(eventId, arg0 as Pointer, arg1)
        }
      },
    )

    this.nativeSpanFeedCallbackWrapper = callback

    if (!callback.pointer) {
      throw new Error("Failed to create native span feed callback")
    }

    return callback
  }

  private setEventCallback(callbackPtr: Pointer) {
    this.opentui.symbols.setEventCallback(callbackPtr)
  }

  public createRenderer(width: number, height: number, options: { testing?: boolean; remote?: boolean } = {}) {
    const testing = options.testing ?? false
    const remote = options.remote ?? false
    return this.opentui.symbols.createRenderer(width, height, testing, remote)
  }

  public destroyRenderer(renderer: Pointer): void {
    this.opentui.symbols.destroyRenderer(renderer)
  }

  public setUseThread(renderer: Pointer, useThread: boolean) {
    this.opentui.symbols.setUseThread(renderer, useThread)
  }

  public setBackgroundColor(renderer: Pointer, color: RGBA) {
    this.opentui.symbols.setBackgroundColor(renderer, color.buffer)
  }

  public setRenderOffset(renderer: Pointer, offset: number) {
    this.opentui.symbols.setRenderOffset(renderer, offset)
  }

  public updateStats(renderer: Pointer, time: number, fps: number, frameCallbackTime: number) {
    this.opentui.symbols.updateStats(renderer, time, fps, frameCallbackTime)
  }

  public updateMemoryStats(renderer: Pointer, heapUsed: number, heapTotal: number, arrayBuffers: number) {
    this.opentui.symbols.updateMemoryStats(renderer, heapUsed, heapTotal, arrayBuffers)
  }

  public getNextBuffer(renderer: Pointer): OptimizedBuffer {
    const bufferPtr = this.opentui.symbols.getNextBuffer(renderer)
    if (!bufferPtr) {
      throw new Error("Failed to get next buffer")
    }

    const width = this.opentui.symbols.getBufferWidth(bufferPtr)
    const height = this.opentui.symbols.getBufferHeight(bufferPtr)

    return new OptimizedBuffer(this, bufferPtr, width, height, { id: "next buffer", widthMethod: "unicode" })
  }

  public getCurrentBuffer(renderer: Pointer): OptimizedBuffer {
    const bufferPtr = this.opentui.symbols.getCurrentBuffer(renderer)
    if (!bufferPtr) {
      throw new Error("Failed to get current buffer")
    }

    const width = this.opentui.symbols.getBufferWidth(bufferPtr)
    const height = this.opentui.symbols.getBufferHeight(bufferPtr)

    return new OptimizedBuffer(this, bufferPtr, width, height, { id: "current buffer", widthMethod: "unicode" })
  }

  public bufferGetCharPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.bufferGetCharPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get char pointer")
    }
    return ptr
  }

  public bufferGetFgPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.bufferGetFgPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get fg pointer")
    }
    return ptr
  }

  public bufferGetBgPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.bufferGetBgPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get bg pointer")
    }
    return ptr
  }

  public bufferGetAttributesPtr(buffer: Pointer): Pointer {
    const ptr = this.opentui.symbols.bufferGetAttributesPtr(buffer)
    if (!ptr) {
      throw new Error("Failed to get attributes pointer")
    }
    return ptr
  }

  public bufferGetRespectAlpha(buffer: Pointer): boolean {
    return this.opentui.symbols.bufferGetRespectAlpha(buffer)
  }

  public bufferSetRespectAlpha(buffer: Pointer, respectAlpha: boolean): void {
    this.opentui.symbols.bufferSetRespectAlpha(buffer, respectAlpha)
  }

  public bufferGetId(buffer: Pointer): string {
    const maxLen = 256
    const outBuffer = new Uint8Array(maxLen)
    const actualLen = this.opentui.symbols.bufferGetId(buffer, outBuffer, maxLen)
    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen
    return this.decoder.decode(outBuffer.slice(0, len))
  }

  public bufferGetRealCharSize(buffer: Pointer): number {
    return this.opentui.symbols.bufferGetRealCharSize(buffer)
  }

  public bufferWriteResolvedChars(buffer: Pointer, outputBuffer: Uint8Array, addLineBreaks: boolean): number {
    const bytesWritten = this.opentui.symbols.bufferWriteResolvedChars(
      buffer,
      outputBuffer,
      outputBuffer.length,
      addLineBreaks,
    )
    return typeof bytesWritten === "bigint" ? Number(bytesWritten) : bytesWritten
  }

  public getBufferWidth(buffer: Pointer): number {
    return this.opentui.symbols.getBufferWidth(buffer)
  }

  public getBufferHeight(buffer: Pointer): number {
    return this.opentui.symbols.getBufferHeight(buffer)
  }

  public bufferClear(buffer: Pointer, color: RGBA) {
    this.opentui.symbols.bufferClear(buffer, color.buffer)
  }

  public bufferDrawText(
    buffer: Pointer,
    text: string,
    x: number,
    y: number,
    color: RGBA,
    bgColor?: RGBA,
    attributes?: number,
  ) {
    const textBytes = this.encoder.encode(text)
    const textLength = textBytes.byteLength
    const bg = bgColor ? bgColor.buffer : null
    const fg = color.buffer

    this.opentui.symbols.bufferDrawText(buffer, textBytes, textLength, x, y, fg, bg ? bg : null, attributes ?? 0)
  }

  public bufferSetCellWithAlphaBlending(
    buffer: Pointer,
    x: number,
    y: number,
    char: string,
    color: RGBA,
    bgColor: RGBA,
    attributes?: number,
  ) {
    const charPtr = char.codePointAt(0) ?? " ".codePointAt(0)!
    const bg = bgColor.buffer
    const fg = color.buffer

    this.opentui.symbols.bufferSetCellWithAlphaBlending(buffer, x, y, charPtr, fg, bg, attributes ?? 0)
  }

  public bufferSetCell(
    buffer: Pointer,
    x: number,
    y: number,
    char: string,
    color: RGBA,
    bgColor: RGBA,
    attributes?: number,
  ) {
    const charPtr = char.codePointAt(0) ?? " ".codePointAt(0)!
    const bg = bgColor.buffer
    const fg = color.buffer

    this.opentui.symbols.bufferSetCell(buffer, x, y, charPtr, fg, bg, attributes ?? 0)
  }

  public bufferFillRect(buffer: Pointer, x: number, y: number, width: number, height: number, color: RGBA) {
    const bg = color.buffer
    this.opentui.symbols.bufferFillRect(buffer, x, y, width, height, bg)
  }

  public bufferDrawSuperSampleBuffer(
    buffer: Pointer,
    x: number,
    y: number,
    pixelDataPtr: Pointer,
    pixelDataLength: number,
    format: "bgra8unorm" | "rgba8unorm",
    alignedBytesPerRow: number,
  ): void {
    const formatId = format === "bgra8unorm" ? 0 : 1
    this.opentui.symbols.bufferDrawSuperSampleBuffer(
      buffer,
      x,
      y,
      pixelDataPtr,
      pixelDataLength,
      formatId,
      alignedBytesPerRow,
    )
  }

  public bufferDrawPackedBuffer(
    buffer: Pointer,
    dataPtr: Pointer,
    dataLen: number,
    posX: number,
    posY: number,
    terminalWidthCells: number,
    terminalHeightCells: number,
  ): void {
    this.opentui.symbols.bufferDrawPackedBuffer(
      buffer,
      dataPtr,
      dataLen,
      posX,
      posY,
      terminalWidthCells,
      terminalHeightCells,
    )
  }

  public bufferDrawGrayscaleBuffer(
    buffer: Pointer,
    posX: number,
    posY: number,
    intensitiesPtr: Pointer,
    srcWidth: number,
    srcHeight: number,
    fg: RGBA | null,
    bg: RGBA | null,
  ): void {
    this.opentui.symbols.bufferDrawGrayscaleBuffer(
      buffer,
      posX,
      posY,
      intensitiesPtr,
      srcWidth,
      srcHeight,
      fg ? fg.buffer : null,
      bg ? bg.buffer : null,
    )
  }

  public bufferDrawGrayscaleBufferSupersampled(
    buffer: Pointer,
    posX: number,
    posY: number,
    intensitiesPtr: Pointer,
    srcWidth: number,
    srcHeight: number,
    fg: RGBA | null,
    bg: RGBA | null,
  ): void {
    this.opentui.symbols.bufferDrawGrayscaleBufferSupersampled(
      buffer,
      posX,
      posY,
      intensitiesPtr,
      srcWidth,
      srcHeight,
      fg ? fg.buffer : null,
      bg ? bg.buffer : null,
    )
  }

  public bufferDrawBox(
    buffer: Pointer,
    x: number,
    y: number,
    width: number,
    height: number,
    borderChars: Uint32Array,
    packedOptions: number,
    borderColor: RGBA,
    backgroundColor: RGBA,
    title: string | null,
  ): void {
    const titleBytes = title ? this.encoder.encode(title) : null
    const titleLen = title ? titleBytes!.length : 0
    const titlePtr = title ? titleBytes : null

    this.opentui.symbols.bufferDrawBox(
      buffer,
      x,
      y,
      width,
      height,
      borderChars,
      packedOptions,
      borderColor.buffer,
      backgroundColor.buffer,
      titlePtr ? titlePtr : null,
      titleLen,
    )
  }

  public bufferResize(buffer: Pointer, width: number, height: number): void {
    this.opentui.symbols.bufferResize(buffer, width, height)
  }

  // Link API
  public linkAlloc(url: string): number {
    const urlBytes = this.encoder.encode(url)
    return this.opentui.symbols.linkAlloc(urlBytes, urlBytes.length)
  }

  public linkGetUrl(linkId: number, maxLen: number = 512): string {
    const outBuffer = new Uint8Array(maxLen)
    const actualLen = this.opentui.symbols.linkGetUrl(linkId, outBuffer, maxLen)
    return this.decoder.decode(outBuffer.slice(0, actualLen))
  }

  public attributesWithLink(baseAttributes: number, linkId: number): number {
    return this.opentui.symbols.attributesWithLink(baseAttributes, linkId)
  }

  public attributesGetLinkId(attributes: number): number {
    return this.opentui.symbols.attributesGetLinkId(attributes)
  }

  public resizeRenderer(renderer: Pointer, width: number, height: number) {
    this.opentui.symbols.resizeRenderer(renderer, width, height)
  }

  public setCursorPosition(renderer: Pointer, x: number, y: number, visible: boolean) {
    this.opentui.symbols.setCursorPosition(renderer, x, y, visible)
  }

  public setCursorStyle(renderer: Pointer, style: CursorStyle, blinking: boolean) {
    const stylePtr = this.encoder.encode(style)
    this.opentui.symbols.setCursorStyle(renderer, stylePtr, style.length, blinking)
  }

  public setCursorColor(renderer: Pointer, color: RGBA) {
    this.opentui.symbols.setCursorColor(renderer, color.buffer)
  }

  public getCursorState(renderer: Pointer): CursorState {
    const cursorBuffer = new Uint8Array(CursorStateStruct.size)
    this.opentui.symbols.getCursorState(renderer, cursorBuffer)
    const struct = CursorStateStruct.unpack(cursorBuffer.buffer)

    const styleMap: Record<number, CursorStyle> = {
      0: "block",
      1: "line",
      2: "underline",
    }

    return {
      x: struct.x,
      y: struct.y,
      visible: struct.visible,
      style: styleMap[struct.style] || "block",
      blinking: struct.blinking,
      color: RGBA.fromValues(struct.r, struct.g, struct.b, struct.a),
    }
  }

  public render(renderer: Pointer, force: boolean) {
    this.opentui.symbols.render(renderer, force)
  }

  public createOptimizedBuffer(
    width: number,
    height: number,
    widthMethod: WidthMethod,
    respectAlpha: boolean = false,
    id?: string,
  ): OptimizedBuffer {
    if (Number.isNaN(width) || Number.isNaN(height)) {
      console.error(new Error(`Invalid dimensions for OptimizedBuffer: ${width}x${height}`).stack)
    }

    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1
    const idToUse = id || "unnamed buffer"
    const idBytes = this.encoder.encode(idToUse)
    const bufferPtr = this.opentui.symbols.createOptimizedBuffer(
      width,
      height,
      respectAlpha,
      widthMethodCode,
      idBytes,
      idBytes.length,
    )
    if (!bufferPtr) {
      throw new Error(`Failed to create optimized buffer: ${width}x${height}`)
    }

    return new OptimizedBuffer(this, bufferPtr, width, height, { respectAlpha, id, widthMethod })
  }

  public destroyOptimizedBuffer(bufferPtr: Pointer) {
    this.opentui.symbols.destroyOptimizedBuffer(bufferPtr)
  }

  public drawFrameBuffer(
    targetBufferPtr: Pointer,
    destX: number,
    destY: number,
    bufferPtr: Pointer,
    sourceX?: number,
    sourceY?: number,
    sourceWidth?: number,
    sourceHeight?: number,
  ) {
    const srcX = sourceX ?? 0
    const srcY = sourceY ?? 0
    const srcWidth = sourceWidth ?? 0
    const srcHeight = sourceHeight ?? 0
    this.opentui.symbols.drawFrameBuffer(targetBufferPtr, destX, destY, bufferPtr, srcX, srcY, srcWidth, srcHeight)
  }

  public setDebugOverlay(renderer: Pointer, enabled: boolean, corner: DebugOverlayCorner) {
    this.opentui.symbols.setDebugOverlay(renderer, enabled, corner)
  }

  public clearTerminal(renderer: Pointer) {
    this.opentui.symbols.clearTerminal(renderer)
  }

  public setTerminalTitle(renderer: Pointer, title: string) {
    const titleBytes = this.encoder.encode(title)
    this.opentui.symbols.setTerminalTitle(renderer, titleBytes, titleBytes.length)
  }

  public copyToClipboardOSC52(renderer: Pointer, target: number, payload: Uint8Array): boolean {
    return this.opentui.symbols.copyToClipboardOSC52(renderer, target, payload, payload.length)
  }

  public clearClipboardOSC52(renderer: Pointer, target: number): boolean {
    return this.opentui.symbols.clearClipboardOSC52(renderer, target)
  }

  public addToHitGrid(renderer: Pointer, x: number, y: number, width: number, height: number, id: number) {
    this.opentui.symbols.addToHitGrid(renderer, x, y, width, height, id)
  }

  public clearCurrentHitGrid(renderer: Pointer) {
    this.opentui.symbols.clearCurrentHitGrid(renderer)
  }

  public hitGridPushScissorRect(renderer: Pointer, x: number, y: number, width: number, height: number) {
    this.opentui.symbols.hitGridPushScissorRect(renderer, x, y, width, height)
  }

  public hitGridPopScissorRect(renderer: Pointer) {
    this.opentui.symbols.hitGridPopScissorRect(renderer)
  }

  public hitGridClearScissorRects(renderer: Pointer) {
    this.opentui.symbols.hitGridClearScissorRects(renderer)
  }

  public addToCurrentHitGridClipped(
    renderer: Pointer,
    x: number,
    y: number,
    width: number,
    height: number,
    id: number,
  ) {
    this.opentui.symbols.addToCurrentHitGridClipped(renderer, x, y, width, height, id)
  }

  public checkHit(renderer: Pointer, x: number, y: number): number {
    return this.opentui.symbols.checkHit(renderer, x, y)
  }

  public getHitGridDirty(renderer: Pointer): boolean {
    return this.opentui.symbols.getHitGridDirty(renderer)
  }

  public dumpHitGrid(renderer: Pointer): void {
    this.opentui.symbols.dumpHitGrid(renderer)
  }

  public dumpBuffers(renderer: Pointer, timestamp?: number): void {
    const ts = timestamp ?? Date.now()
    this.opentui.symbols.dumpBuffers(renderer, ts)
  }

  public dumpStdoutBuffer(renderer: Pointer, timestamp?: number): void {
    const ts = timestamp ?? Date.now()
    this.opentui.symbols.dumpStdoutBuffer(renderer, ts)
  }

  public restoreTerminalModes(renderer: Pointer): void {
    this.opentui.symbols.restoreTerminalModes(renderer)
  }

  public enableMouse(renderer: Pointer, enableMovement: boolean): void {
    this.opentui.symbols.enableMouse(renderer, enableMovement)
  }

  public disableMouse(renderer: Pointer): void {
    this.opentui.symbols.disableMouse(renderer)
  }

  public enableKittyKeyboard(renderer: Pointer, flags: number): void {
    this.opentui.symbols.enableKittyKeyboard(renderer, flags)
  }

  public disableKittyKeyboard(renderer: Pointer): void {
    this.opentui.symbols.disableKittyKeyboard(renderer)
  }

  public setKittyKeyboardFlags(renderer: Pointer, flags: number): void {
    this.opentui.symbols.setKittyKeyboardFlags(renderer, flags)
  }

  public getKittyKeyboardFlags(renderer: Pointer): number {
    return this.opentui.symbols.getKittyKeyboardFlags(renderer)
  }

  public setupTerminal(renderer: Pointer, useAlternateScreen: boolean): void {
    this.opentui.symbols.setupTerminal(renderer, useAlternateScreen)
  }

  public suspendRenderer(renderer: Pointer): void {
    this.opentui.symbols.suspendRenderer(renderer)
  }

  public resumeRenderer(renderer: Pointer): void {
    this.opentui.symbols.resumeRenderer(renderer)
  }

  public queryPixelResolution(renderer: Pointer): void {
    this.opentui.symbols.queryPixelResolution(renderer)
  }

  /**
   * Write data to stdout, synchronizing with the render thread if necessary.
   * This should be used for ALL stdout writes to avoid race conditions when
   * the render thread is active.
   */
  public writeOut(renderer: Pointer, data: string | Uint8Array): void {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
    if (bytes.length === 0) return
    this.opentui.symbols.writeOut(renderer, bytes, bytes.length)
  }

  // TextBuffer methods
  public createTextBuffer(widthMethod: WidthMethod): TextBuffer {
    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1
    const bufferPtr = this.opentui.symbols.createTextBuffer(widthMethodCode)
    if (!bufferPtr) {
      throw new Error(`Failed to create TextBuffer`)
    }

    return new TextBuffer(this, bufferPtr)
  }

  public destroyTextBuffer(buffer: Pointer): void {
    this.opentui.symbols.destroyTextBuffer(buffer)
  }

  public textBufferGetLength(buffer: Pointer): number {
    return this.opentui.symbols.textBufferGetLength(buffer)
  }

  public textBufferGetByteSize(buffer: Pointer): number {
    return this.opentui.symbols.textBufferGetByteSize(buffer)
  }

  public textBufferReset(buffer: Pointer): void {
    this.opentui.symbols.textBufferReset(buffer)
  }

  public textBufferClear(buffer: Pointer): void {
    this.opentui.symbols.textBufferClear(buffer)
  }

  public textBufferSetDefaultFg(buffer: Pointer, fg: RGBA | null): void {
    const fgPtr = fg ? fg.buffer : null
    this.opentui.symbols.textBufferSetDefaultFg(buffer, fgPtr)
  }

  public textBufferSetDefaultBg(buffer: Pointer, bg: RGBA | null): void {
    const bgPtr = bg ? bg.buffer : null
    this.opentui.symbols.textBufferSetDefaultBg(buffer, bgPtr)
  }

  public textBufferSetDefaultAttributes(buffer: Pointer, attributes: number | null): void {
    const attrValue = attributes === null ? null : new Uint8Array([attributes])
    this.opentui.symbols.textBufferSetDefaultAttributes(buffer, attrValue)
  }

  public textBufferResetDefaults(buffer: Pointer): void {
    this.opentui.symbols.textBufferResetDefaults(buffer)
  }

  public textBufferGetTabWidth(buffer: Pointer): number {
    return this.opentui.symbols.textBufferGetTabWidth(buffer)
  }

  public textBufferSetTabWidth(buffer: Pointer, width: number): void {
    this.opentui.symbols.textBufferSetTabWidth(buffer, width)
  }

  public textBufferRegisterMemBuffer(buffer: Pointer, bytes: Uint8Array, owned: boolean = false): number {
    const result = this.opentui.symbols.textBufferRegisterMemBuffer(buffer, bytes, bytes.length, owned)
    if (result === 0xffff) {
      throw new Error("Failed to register memory buffer")
    }
    return result
  }

  public textBufferReplaceMemBuffer(
    buffer: Pointer,
    memId: number,
    bytes: Uint8Array,
    owned: boolean = false,
  ): boolean {
    return this.opentui.symbols.textBufferReplaceMemBuffer(buffer, memId, bytes, bytes.length, owned)
  }

  public textBufferClearMemRegistry(buffer: Pointer): void {
    this.opentui.symbols.textBufferClearMemRegistry(buffer)
  }

  public textBufferSetTextFromMem(buffer: Pointer, memId: number): void {
    this.opentui.symbols.textBufferSetTextFromMem(buffer, memId)
  }

  public textBufferAppend(buffer: Pointer, bytes: Uint8Array): void {
    this.opentui.symbols.textBufferAppend(buffer, bytes, bytes.length)
  }

  public textBufferAppendFromMemId(buffer: Pointer, memId: number): void {
    this.opentui.symbols.textBufferAppendFromMemId(buffer, memId)
  }

  public textBufferLoadFile(buffer: Pointer, path: string): boolean {
    const pathBytes = this.encoder.encode(path)
    return this.opentui.symbols.textBufferLoadFile(buffer, pathBytes, pathBytes.length)
  }

  public textBufferSetStyledText(
    buffer: Pointer,
    chunks: Array<{ text: string; fg?: RGBA | null; bg?: RGBA | null; attributes?: number; link?: { url: string } }>,
  ): void {
    // TODO: This should be a filter on the struct packing to not iterate twice
    const nonEmptyChunks = chunks.filter((c) => c.text.length > 0)
    if (nonEmptyChunks.length === 0) {
      this.textBufferClear(buffer)
      return
    }

    // Allocate link IDs and pack them into attributes
    const processedChunks = nonEmptyChunks.map((chunk) => {
      if (chunk.link) {
        const linkId = this.linkAlloc(chunk.link.url)
        return {
          ...chunk,
          attributes: attributesWithLink(chunk.attributes ?? 0, linkId),
        }
      }
      return chunk
    })

    const chunksBuffer = StyledChunkStruct.packList(processedChunks)

    this.opentui.symbols.textBufferSetStyledText(buffer, chunksBuffer, processedChunks.length)
  }

  public textBufferGetLineCount(buffer: Pointer): number {
    return this.opentui.symbols.textBufferGetLineCount(buffer)
  }

  private textBufferGetPlainText(buffer: Pointer, outPtr: Pointer, maxLen: number): number {
    const result = this.opentui.symbols.textBufferGetPlainText(buffer, outPtr, maxLen)
    return typeof result === "bigint" ? Number(result) : result
  }

  public getPlainTextBytes(buffer: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)

    const actualLen = this.textBufferGetPlainText(buffer, outBuffer, maxLength)

    if (actualLen === 0) {
      return null
    }

    return outBuffer.slice(0, actualLen)
  }

  public textBufferGetTextRange(
    buffer: Pointer,
    startOffset: number,
    endOffset: number,
    maxLength: number,
  ): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)

    const actualLen = this.opentui.symbols.textBufferGetTextRange(
      buffer,
      startOffset,
      endOffset,
      outBuffer,
      maxLength,
    )

    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen

    if (len === 0) {
      return null
    }

    return outBuffer.slice(0, len)
  }

  public textBufferGetTextRangeByCoords(
    buffer: Pointer,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    maxLength: number,
  ): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)

    const actualLen = this.opentui.symbols.textBufferGetTextRangeByCoords(
      buffer,
      startRow,
      startCol,
      endRow,
      endCol,
      outBuffer,
      maxLength,
    )

    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen

    if (len === 0) {
      return null
    }

    return outBuffer.slice(0, len)
  }

  // TextBufferView methods
  public createTextBufferView(textBuffer: Pointer): Pointer {
    const viewPtr = this.opentui.symbols.createTextBufferView(textBuffer)
    if (!viewPtr) {
      throw new Error("Failed to create TextBufferView")
    }
    return viewPtr
  }

  public destroyTextBufferView(view: Pointer): void {
    this.opentui.symbols.destroyTextBufferView(view)
  }

  public textBufferViewSetSelection(
    view: Pointer,
    start: number,
    end: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ): void {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    this.opentui.symbols.textBufferViewSetSelection(view, start, end, bg, fg)
  }

  public textBufferViewResetSelection(view: Pointer): void {
    this.opentui.symbols.textBufferViewResetSelection(view)
  }

  public textBufferViewGetSelection(view: Pointer): { start: number; end: number } | null {
    const packedInfo = this.textBufferViewGetSelectionInfo(view)

    // Check for no selection marker (0xFFFFFFFF_FFFFFFFF)
    if (packedInfo === 0xffff_ffff_ffff_ffffn) {
      return null
    }

    const start = Number(packedInfo >> 32n)
    const end = Number(packedInfo & 0xffff_ffffn)

    return { start, end }
  }

  private textBufferViewGetSelectionInfo(view: Pointer): bigint {
    return this.opentui.symbols.textBufferViewGetSelectionInfo(view)
  }

  public textBufferViewSetLocalSelection(
    view: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ): boolean {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    return this.opentui.symbols.textBufferViewSetLocalSelection(view, anchorX, anchorY, focusX, focusY, bg, fg)
  }

  public textBufferViewUpdateSelection(view: Pointer, end: number, bgColor: RGBA | null, fgColor: RGBA | null): void {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    this.opentui.symbols.textBufferViewUpdateSelection(view, end, bg, fg)
  }

  public textBufferViewUpdateLocalSelection(
    view: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ): boolean {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    return this.opentui.symbols.textBufferViewUpdateLocalSelection(view, anchorX, anchorY, focusX, focusY, bg, fg)
  }

  public textBufferViewResetLocalSelection(view: Pointer): void {
    this.opentui.symbols.textBufferViewResetLocalSelection(view)
  }

  public textBufferViewSetWrapWidth(view: Pointer, width: number): void {
    this.opentui.symbols.textBufferViewSetWrapWidth(view, width)
  }

  public textBufferViewSetWrapMode(view: Pointer, mode: "none" | "char" | "word"): void {
    const modeValue = mode === "none" ? 0 : mode === "char" ? 1 : 2
    this.opentui.symbols.textBufferViewSetWrapMode(view, modeValue)
  }

  public textBufferViewSetViewportSize(view: Pointer, width: number, height: number): void {
    this.opentui.symbols.textBufferViewSetViewportSize(view, width, height)
  }

  public textBufferViewSetViewport(view: Pointer, x: number, y: number, width: number, height: number): void {
    this.opentui.symbols.textBufferViewSetViewport(view, x, y, width, height)
  }

  public textBufferViewGetLineInfo(view: Pointer): LineInfo {
    const outBuffer = new Uint8Array(LineInfoStruct.size)
    this.textBufferViewGetLineInfoDirect(view, outBuffer)
    const struct = LineInfoStruct.unpack(outBuffer.buffer)
    return {
      maxLineWidth: struct.maxWidth,
      lineStarts: struct.starts as number[],
      lineWidths: struct.widths as number[],
      lineSources: struct.sources as number[],
      lineWraps: struct.wraps as number[],
    }
  }

  public textBufferViewGetLogicalLineInfo(view: Pointer): LineInfo {
    const outBuffer = new Uint8Array(LineInfoStruct.size)
    this.textBufferViewGetLogicalLineInfoDirect(view, outBuffer)
    const struct = LineInfoStruct.unpack(outBuffer.buffer)
    return {
      maxLineWidth: struct.maxWidth,
      lineStarts: struct.starts as number[],
      lineWidths: struct.widths as number[],
      lineSources: struct.sources as number[],
      lineWraps: struct.wraps as number[],
    }
  }

  public textBufferViewGetVirtualLineCount(view: Pointer): number {
    return this.opentui.symbols.textBufferViewGetVirtualLineCount(view)
  }

  private textBufferViewGetLineInfoDirect(view: Pointer, outPtr: Pointer): void {
    this.opentui.symbols.textBufferViewGetLineInfoDirect(view, outPtr)
  }

  private textBufferViewGetLogicalLineInfoDirect(view: Pointer, outPtr: Pointer): void {
    this.opentui.symbols.textBufferViewGetLogicalLineInfoDirect(view, outPtr)
  }

  private textBufferViewGetSelectedText(view: Pointer, outPtr: Pointer, maxLen: number): number {
    const result = this.opentui.symbols.textBufferViewGetSelectedText(view, outPtr, maxLen)
    return typeof result === "bigint" ? Number(result) : result
  }

  private textBufferViewGetPlainText(view: Pointer, outPtr: Pointer, maxLen: number): number {
    const result = this.opentui.symbols.textBufferViewGetPlainText(view, outPtr, maxLen)
    return typeof result === "bigint" ? Number(result) : result
  }

  public textBufferViewGetSelectedTextBytes(view: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)

    const actualLen = this.textBufferViewGetSelectedText(view, outBuffer, maxLength)

    if (actualLen === 0) {
      return null
    }

    return outBuffer.slice(0, actualLen)
  }

  public textBufferViewGetPlainTextBytes(view: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)

    const actualLen = this.textBufferViewGetPlainText(view, outBuffer, maxLength)

    if (actualLen === 0) {
      return null
    }

    return outBuffer.slice(0, actualLen)
  }

  public textBufferViewSetTabIndicator(view: Pointer, indicator: number): void {
    this.opentui.symbols.textBufferViewSetTabIndicator(view, indicator)
  }

  public textBufferViewSetTabIndicatorColor(view: Pointer, color: RGBA): void {
    this.opentui.symbols.textBufferViewSetTabIndicatorColor(view, color.buffer)
  }

  public textBufferViewSetTruncate(view: Pointer, truncate: boolean): void {
    this.opentui.symbols.textBufferViewSetTruncate(view, truncate)
  }

  public textBufferViewMeasureForDimensions(
    view: Pointer,
    width: number,
    height: number,
  ): { lineCount: number; maxWidth: number } | null {
    const resultBuffer = new Uint8Array(MeasureResultStruct.size)
    const success = this.opentui.symbols.textBufferViewMeasureForDimensions(view, width, height, resultBuffer)
    if (!success) {
      return null
    }
    const result = MeasureResultStruct.unpack(resultBuffer.buffer)
    return result
  }

  public textBufferAddHighlightByCharRange(buffer: Pointer, highlight: Highlight): void {
    const packedHighlight = HighlightStruct.pack(highlight)
    this.opentui.symbols.textBufferAddHighlightByCharRange(buffer, packedHighlight)
  }

  public textBufferAddHighlight(buffer: Pointer, lineIdx: number, highlight: Highlight): void {
    const packedHighlight = HighlightStruct.pack(highlight)
    this.opentui.symbols.textBufferAddHighlight(buffer, lineIdx, packedHighlight)
  }

  public textBufferRemoveHighlightsByRef(buffer: Pointer, hlRef: number): void {
    this.opentui.symbols.textBufferRemoveHighlightsByRef(buffer, hlRef)
  }

  public textBufferClearLineHighlights(buffer: Pointer, lineIdx: number): void {
    this.opentui.symbols.textBufferClearLineHighlights(buffer, lineIdx)
  }

  public textBufferClearAllHighlights(buffer: Pointer): void {
    this.opentui.symbols.textBufferClearAllHighlights(buffer)
  }

  public textBufferSetSyntaxStyle(buffer: Pointer, style: Pointer | null): void {
    this.opentui.symbols.textBufferSetSyntaxStyle(buffer, style)
  }

  public textBufferGetLineHighlights(buffer: Pointer, lineIdx: number): Array<Highlight> {
    const outCountBuf = new BigUint64Array(1)

    const nativePtr = this.opentui.symbols.textBufferGetLineHighlightsPtr(buffer, lineIdx, outCountBuf)
    if (!nativePtr) return []

    const count = Number(outCountBuf[0])
    const byteLen = count * HighlightStruct.size
    const raw = toArrayBuffer(nativePtr, 0, byteLen)
    const results = HighlightStruct.unpackList(raw, count)

    this.opentui.symbols.textBufferFreeLineHighlights(nativePtr, count)

    return results
  }

  public textBufferGetHighlightCount(buffer: Pointer): number {
    return this.opentui.symbols.textBufferGetHighlightCount(buffer)
  }

  public getArenaAllocatedBytes(): number {
    const result = this.opentui.symbols.getArenaAllocatedBytes()
    return typeof result === "bigint" ? Number(result) : result
  }

  public bufferDrawTextBufferView(buffer: Pointer, view: Pointer, x: number, y: number): void {
    this.opentui.symbols.bufferDrawTextBufferView(buffer, view, x, y)
  }

  public bufferDrawEditorView(buffer: Pointer, view: Pointer, x: number, y: number): void {
    this.opentui.symbols.bufferDrawEditorView(buffer, view, x, y)
  }

  // EditorView methods
  public createEditorView(editBufferPtr: Pointer, viewportWidth: number, viewportHeight: number): Pointer {
    const viewPtr = this.opentui.symbols.createEditorView(editBufferPtr, viewportWidth, viewportHeight)
    if (!viewPtr) {
      throw new Error("Failed to create EditorView")
    }
    return viewPtr
  }

  public destroyEditorView(view: Pointer): void {
    this.opentui.symbols.destroyEditorView(view)
  }

  public editorViewSetViewportSize(view: Pointer, width: number, height: number): void {
    this.opentui.symbols.editorViewSetViewportSize(view, width, height)
  }

  public editorViewSetViewport(
    view: Pointer,
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor: boolean,
  ): void {
    this.opentui.symbols.editorViewSetViewport(view, x, y, width, height, moveCursor)
  }

  public editorViewGetViewport(view: Pointer): { offsetY: number; offsetX: number; height: number; width: number } {
    const x = new Uint32Array(1)
    const y = new Uint32Array(1)
    const width = new Uint32Array(1)
    const height = new Uint32Array(1)

    this.opentui.symbols.editorViewGetViewport(view, x, y, width, height)

    return {
      offsetX: x[0],
      offsetY: y[0],
      width: width[0],
      height: height[0],
    }
  }

  public editorViewSetScrollMargin(view: Pointer, margin: number): void {
    this.opentui.symbols.editorViewSetScrollMargin(view, margin)
  }

  public editorViewSetWrapMode(view: Pointer, mode: "none" | "char" | "word"): void {
    const modeValue = mode === "none" ? 0 : mode === "char" ? 1 : 2
    this.opentui.symbols.editorViewSetWrapMode(view, modeValue)
  }

  public editorViewGetVirtualLineCount(view: Pointer): number {
    return this.opentui.symbols.editorViewGetVirtualLineCount(view)
  }

  public editorViewGetTotalVirtualLineCount(view: Pointer): number {
    return this.opentui.symbols.editorViewGetTotalVirtualLineCount(view)
  }

  public editorViewGetTextBufferView(view: Pointer): Pointer {
    const result = this.opentui.symbols.editorViewGetTextBufferView(view)
    if (!result) {
      throw new Error("Failed to get TextBufferView from EditorView")
    }
    return result
  }

  public editorViewGetLineInfo(view: Pointer): LineInfo {
    const outBuffer = new Uint8Array(LineInfoStruct.size)
    this.opentui.symbols.editorViewGetLineInfoDirect(view, outBuffer)
    const struct = LineInfoStruct.unpack(outBuffer.buffer)
    return {
      maxLineWidth: struct.maxWidth,
      lineStarts: struct.starts as number[],
      lineWidths: struct.widths as number[],
      lineSources: struct.sources as number[],
      lineWraps: struct.wraps as number[],
    }
  }

  public editorViewGetLogicalLineInfo(view: Pointer): LineInfo {
    const outBuffer = new Uint8Array(LineInfoStruct.size)
    this.opentui.symbols.editorViewGetLogicalLineInfoDirect(view, outBuffer)
    const struct = LineInfoStruct.unpack(outBuffer.buffer)
    return {
      maxLineWidth: struct.maxWidth,
      lineStarts: struct.starts as number[],
      lineWidths: struct.widths as number[],
      lineSources: struct.sources as number[],
      lineWraps: struct.wraps as number[],
    }
  }

  // EditBuffer implementations
  public createEditBuffer(widthMethod: WidthMethod): Pointer {
    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1
    const bufferPtr = this.opentui.symbols.createEditBuffer(widthMethodCode)
    if (!bufferPtr) {
      throw new Error("Failed to create EditBuffer")
    }
    return bufferPtr
  }

  public destroyEditBuffer(buffer: Pointer): void {
    this.opentui.symbols.destroyEditBuffer(buffer)
  }

  public editBufferSetText(buffer: Pointer, textBytes: Uint8Array): void {
    this.opentui.symbols.editBufferSetText(buffer, textBytes, textBytes.length)
  }

  public editBufferSetTextFromMem(buffer: Pointer, memId: number): void {
    this.opentui.symbols.editBufferSetTextFromMem(buffer, memId)
  }

  public editBufferReplaceText(buffer: Pointer, textBytes: Uint8Array): void {
    this.opentui.symbols.editBufferReplaceText(buffer, textBytes, textBytes.length)
  }

  public editBufferReplaceTextFromMem(buffer: Pointer, memId: number): void {
    this.opentui.symbols.editBufferReplaceTextFromMem(buffer, memId)
  }

  public editBufferGetText(buffer: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)
    const actualLen = this.opentui.symbols.editBufferGetText(buffer, outBuffer, maxLength)
    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen
    if (len === 0) return null
    return outBuffer.slice(0, len)
  }

  public editBufferInsertChar(buffer: Pointer, char: string): void {
    const charBytes = this.encoder.encode(char)
    this.opentui.symbols.editBufferInsertChar(buffer, charBytes, charBytes.length)
  }

  public editBufferInsertText(buffer: Pointer, text: string): void {
    const textBytes = this.encoder.encode(text)
    this.opentui.symbols.editBufferInsertText(buffer, textBytes, textBytes.length)
  }

  public editBufferDeleteChar(buffer: Pointer): void {
    this.opentui.symbols.editBufferDeleteChar(buffer)
  }

  public editBufferDeleteCharBackward(buffer: Pointer): void {
    this.opentui.symbols.editBufferDeleteCharBackward(buffer)
  }

  public editBufferDeleteRange(
    buffer: Pointer,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
  ): void {
    this.opentui.symbols.editBufferDeleteRange(buffer, startLine, startCol, endLine, endCol)
  }

  public editBufferNewLine(buffer: Pointer): void {
    this.opentui.symbols.editBufferNewLine(buffer)
  }

  public editBufferDeleteLine(buffer: Pointer): void {
    this.opentui.symbols.editBufferDeleteLine(buffer)
  }

  public editBufferMoveCursorLeft(buffer: Pointer): void {
    this.opentui.symbols.editBufferMoveCursorLeft(buffer)
  }

  public editBufferMoveCursorRight(buffer: Pointer): void {
    this.opentui.symbols.editBufferMoveCursorRight(buffer)
  }

  public editBufferMoveCursorUp(buffer: Pointer): void {
    this.opentui.symbols.editBufferMoveCursorUp(buffer)
  }

  public editBufferMoveCursorDown(buffer: Pointer): void {
    this.opentui.symbols.editBufferMoveCursorDown(buffer)
  }

  public editBufferGotoLine(buffer: Pointer, line: number): void {
    this.opentui.symbols.editBufferGotoLine(buffer, line)
  }

  public editBufferSetCursor(buffer: Pointer, line: number, byteOffset: number): void {
    this.opentui.symbols.editBufferSetCursor(buffer, line, byteOffset)
  }

  public editBufferSetCursorToLineCol(buffer: Pointer, line: number, col: number): void {
    this.opentui.symbols.editBufferSetCursorToLineCol(buffer, line, col)
  }

  public editBufferSetCursorByOffset(buffer: Pointer, offset: number): void {
    this.opentui.symbols.editBufferSetCursorByOffset(buffer, offset)
  }

  public editBufferGetCursorPosition(buffer: Pointer): LogicalCursor {
    const cursorBuffer = new Uint8Array(LogicalCursorStruct.size)
    this.opentui.symbols.editBufferGetCursorPosition(buffer, cursorBuffer)
    return LogicalCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editBufferGetId(buffer: Pointer): number {
    return this.opentui.symbols.editBufferGetId(buffer)
  }

  public editBufferGetTextBuffer(buffer: Pointer): Pointer {
    const result = this.opentui.symbols.editBufferGetTextBuffer(buffer)
    if (!result) {
      throw new Error("Failed to get TextBuffer from EditBuffer")
    }
    return result
  }

  public editBufferDebugLogRope(buffer: Pointer): void {
    this.opentui.symbols.editBufferDebugLogRope(buffer)
  }

  public editBufferUndo(buffer: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)
    const actualLen = this.opentui.symbols.editBufferUndo(buffer, outBuffer, maxLength)
    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen
    if (len === 0) return null
    return outBuffer.slice(0, len)
  }

  public editBufferRedo(buffer: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)
    const actualLen = this.opentui.symbols.editBufferRedo(buffer, outBuffer, maxLength)
    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen
    if (len === 0) return null
    return outBuffer.slice(0, len)
  }

  public editBufferCanUndo(buffer: Pointer): boolean {
    return this.opentui.symbols.editBufferCanUndo(buffer)
  }

  public editBufferCanRedo(buffer: Pointer): boolean {
    return this.opentui.symbols.editBufferCanRedo(buffer)
  }

  public editBufferClearHistory(buffer: Pointer): void {
    this.opentui.symbols.editBufferClearHistory(buffer)
  }

  public editBufferClear(buffer: Pointer): void {
    this.opentui.symbols.editBufferClear(buffer)
  }

  public editBufferGetNextWordBoundary(buffer: Pointer): LogicalCursor {
    const cursorBuffer = new Uint8Array(LogicalCursorStruct.size)
    this.opentui.symbols.editBufferGetNextWordBoundary(buffer, cursorBuffer)
    return LogicalCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editBufferGetPrevWordBoundary(buffer: Pointer): LogicalCursor {
    const cursorBuffer = new Uint8Array(LogicalCursorStruct.size)
    this.opentui.symbols.editBufferGetPrevWordBoundary(buffer, cursorBuffer)
    return LogicalCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editBufferGetEOL(buffer: Pointer): LogicalCursor {
    const cursorBuffer = new Uint8Array(LogicalCursorStruct.size)
    this.opentui.symbols.editBufferGetEOL(buffer, cursorBuffer)
    return LogicalCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editBufferOffsetToPosition(buffer: Pointer, offset: number): LogicalCursor | null {
    const cursorBuffer = new Uint8Array(LogicalCursorStruct.size)
    const success = this.opentui.symbols.editBufferOffsetToPosition(buffer, offset, cursorBuffer)
    if (!success) return null
    return LogicalCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editBufferPositionToOffset(buffer: Pointer, row: number, col: number): number {
    return this.opentui.symbols.editBufferPositionToOffset(buffer, row, col)
  }

  public editBufferGetLineStartOffset(buffer: Pointer, row: number): number {
    return this.opentui.symbols.editBufferGetLineStartOffset(buffer, row)
  }

  public editBufferGetTextRange(
    buffer: Pointer,
    startOffset: number,
    endOffset: number,
    maxLength: number,
  ): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)
    const actualLen = this.opentui.symbols.editBufferGetTextRange(
      buffer,
      startOffset,
      endOffset,
      outBuffer,
      maxLength,
    )
    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen
    if (len === 0) return null
    return outBuffer.slice(0, len)
  }

  public editBufferGetTextRangeByCoords(
    buffer: Pointer,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    maxLength: number,
  ): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)
    const actualLen = this.opentui.symbols.editBufferGetTextRangeByCoords(
      buffer,
      startRow,
      startCol,
      endRow,
      endCol,
      outBuffer,
      maxLength,
    )
    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen
    if (len === 0) return null
    return outBuffer.slice(0, len)
  }

  // EditorView selection and editing implementations
  public editorViewSetSelection(
    view: Pointer,
    start: number,
    end: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
  ): void {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    this.opentui.symbols.editorViewSetSelection(view, start, end, bg, fg)
  }

  public editorViewResetSelection(view: Pointer): void {
    this.opentui.symbols.editorViewResetSelection(view)
  }

  public editorViewGetSelection(view: Pointer): { start: number; end: number } | null {
    const packedInfo = this.opentui.symbols.editorViewGetSelection(view)
    if (packedInfo === 0xffff_ffff_ffff_ffffn) {
      return null
    }
    const start = Number(packedInfo >> 32n)
    const end = Number(packedInfo & 0xffff_ffffn)
    return { start, end }
  }

  public editorViewSetLocalSelection(
    view: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
    updateCursor: boolean,
    followCursor: boolean,
  ): boolean {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    return this.opentui.symbols.editorViewSetLocalSelection(
      view,
      anchorX,
      anchorY,
      focusX,
      focusY,
      bg,
      fg,
      updateCursor,
      followCursor,
    )
  }

  public editorViewUpdateSelection(view: Pointer, end: number, bgColor: RGBA | null, fgColor: RGBA | null): void {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    this.opentui.symbols.editorViewUpdateSelection(view, end, bg, fg)
  }

  public editorViewUpdateLocalSelection(
    view: Pointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor: RGBA | null,
    fgColor: RGBA | null,
    updateCursor: boolean,
    followCursor: boolean,
  ): boolean {
    const bg = bgColor ? bgColor.buffer : null
    const fg = fgColor ? fgColor.buffer : null
    return this.opentui.symbols.editorViewUpdateLocalSelection(
      view,
      anchorX,
      anchorY,
      focusX,
      focusY,
      bg,
      fg,
      updateCursor,
      followCursor,
    )
  }

  public editorViewResetLocalSelection(view: Pointer): void {
    this.opentui.symbols.editorViewResetLocalSelection(view)
  }

  public editorViewGetSelectedTextBytes(view: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)
    const actualLen = this.opentui.symbols.editorViewGetSelectedTextBytes(view, outBuffer, maxLength)
    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen
    if (len === 0) return null
    return outBuffer.slice(0, len)
  }

  public editorViewGetCursor(view: Pointer): { row: number; col: number } {
    const row = new Uint32Array(1)
    const col = new Uint32Array(1)
    this.opentui.symbols.editorViewGetCursor(view, row, col)
    return { row: row[0], col: col[0] }
  }

  public editorViewGetText(view: Pointer, maxLength: number): Uint8Array | null {
    const outBuffer = new Uint8Array(maxLength)
    const actualLen = this.opentui.symbols.editorViewGetText(view, outBuffer, maxLength)
    const len = typeof actualLen === "bigint" ? Number(actualLen) : actualLen
    if (len === 0) return null
    return outBuffer.slice(0, len)
  }

  public editorViewGetVisualCursor(view: Pointer): VisualCursor {
    const cursorBuffer = new Uint8Array(VisualCursorStruct.size)
    this.opentui.symbols.editorViewGetVisualCursor(view, cursorBuffer)
    return VisualCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editorViewMoveUpVisual(view: Pointer): void {
    this.opentui.symbols.editorViewMoveUpVisual(view)
  }

  public editorViewMoveDownVisual(view: Pointer): void {
    this.opentui.symbols.editorViewMoveDownVisual(view)
  }

  public editorViewDeleteSelectedText(view: Pointer): void {
    this.opentui.symbols.editorViewDeleteSelectedText(view)
  }

  public editorViewSetCursorByOffset(view: Pointer, offset: number): void {
    this.opentui.symbols.editorViewSetCursorByOffset(view, offset)
  }

  public editorViewGetNextWordBoundary(view: Pointer): VisualCursor {
    const cursorBuffer = new Uint8Array(VisualCursorStruct.size)
    this.opentui.symbols.editorViewGetNextWordBoundary(view, cursorBuffer)
    return VisualCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editorViewGetPrevWordBoundary(view: Pointer): VisualCursor {
    const cursorBuffer = new Uint8Array(VisualCursorStruct.size)
    this.opentui.symbols.editorViewGetPrevWordBoundary(view, cursorBuffer)
    return VisualCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editorViewGetEOL(view: Pointer): VisualCursor {
    const cursorBuffer = new Uint8Array(VisualCursorStruct.size)
    this.opentui.symbols.editorViewGetEOL(view, cursorBuffer)
    return VisualCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editorViewGetVisualSOL(view: Pointer): VisualCursor {
    const cursorBuffer = new Uint8Array(VisualCursorStruct.size)
    this.opentui.symbols.editorViewGetVisualSOL(view, cursorBuffer)
    return VisualCursorStruct.unpack(cursorBuffer.buffer)
  }

  public editorViewGetVisualEOL(view: Pointer): VisualCursor {
    const cursorBuffer = new Uint8Array(VisualCursorStruct.size)
    this.opentui.symbols.editorViewGetVisualEOL(view, cursorBuffer)
    return VisualCursorStruct.unpack(cursorBuffer.buffer)
  }

  public bufferPushScissorRect(buffer: Pointer, x: number, y: number, width: number, height: number): void {
    this.opentui.symbols.bufferPushScissorRect(buffer, x, y, width, height)
  }

  public bufferPopScissorRect(buffer: Pointer): void {
    this.opentui.symbols.bufferPopScissorRect(buffer)
  }

  public bufferClearScissorRects(buffer: Pointer): void {
    this.opentui.symbols.bufferClearScissorRects(buffer)
  }

  public bufferPushOpacity(buffer: Pointer, opacity: number): void {
    this.opentui.symbols.bufferPushOpacity(buffer, opacity)
  }

  public bufferPopOpacity(buffer: Pointer): void {
    this.opentui.symbols.bufferPopOpacity(buffer)
  }

  public bufferGetCurrentOpacity(buffer: Pointer): number {
    return this.opentui.symbols.bufferGetCurrentOpacity(buffer)
  }

  public bufferClearOpacity(buffer: Pointer): void {
    this.opentui.symbols.bufferClearOpacity(buffer)
  }

  public getTerminalCapabilities(renderer: Pointer) {
    const capsBuffer = new Uint8Array(TerminalCapabilitiesStruct.size)
    this.opentui.symbols.getTerminalCapabilities(renderer, capsBuffer)

    const caps = TerminalCapabilitiesStruct.unpack(capsBuffer.buffer)

    return {
      kitty_keyboard: caps.kitty_keyboard,
      kitty_graphics: caps.kitty_graphics,
      rgb: caps.rgb,
      unicode: caps.unicode,
      sgr_pixels: caps.sgr_pixels,
      color_scheme_updates: caps.color_scheme_updates,
      explicit_width: caps.explicit_width,
      scaled_text: caps.scaled_text,
      sixel: caps.sixel,
      focus_tracking: caps.focus_tracking,
      sync: caps.sync,
      bracketed_paste: caps.bracketed_paste,
      hyperlinks: caps.hyperlinks,
      osc52: caps.osc52,
      explicit_cursor_positioning: caps.explicit_cursor_positioning,
      terminal: {
        name: caps.term_name ?? "",
        version: caps.term_version ?? "",
        from_xtversion: caps.term_from_xtversion,
      },
    }
  }

  public processCapabilityResponse(renderer: Pointer, response: string): void {
    const responseBytes = this.encoder.encode(response)
    this.opentui.symbols.processCapabilityResponse(renderer, responseBytes, responseBytes.length)
  }

  public encodeUnicode(
    text: string,
    widthMethod: WidthMethod,
  ): { ptr: Pointer; data: Array<{ width: number; char: number }> } | null {
    const textBytes = this.encoder.encode(text)
    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1

    const outPtrBuffer = new Uint8Array(8) // Pointer size
    const outLenBuffer = new Uint8Array(8) // usize

    const success = this.opentui.symbols.encodeUnicode(
      textBytes,
      textBytes.length,
      outPtrBuffer,
      outLenBuffer,
      widthMethodCode,
    )

    if (!success) {
      return null
    }

    const outPtrView = new BigUint64Array(outPtrBuffer.buffer)
    const outLenView = new BigUint64Array(outLenBuffer.buffer)

    const resultPtr = toPointer(outPtrView[0])
    const resultLen = Number(outLenView[0])

    if (resultLen === 0) {
      return { ptr: resultPtr, data: [] }
    }

    // Convert pointer to ArrayBuffer and use EncodedCharStruct to unpack the list
    const byteLen = resultLen * EncodedCharStruct.size
    const raw = toArrayBuffer(resultPtr, 0, byteLen)
    const data = EncodedCharStruct.unpackList(raw, resultLen)

    return { ptr: resultPtr, data }
  }

  public freeUnicode(encoded: { ptr: Pointer; data: Array<{ width: number; char: number }> }): void {
    this.opentui.symbols.freeUnicode(encoded.ptr, encoded.data.length)
  }

  public bufferDrawChar(
    buffer: Pointer,
    char: number,
    x: number,
    y: number,
    fg: RGBA,
    bg: RGBA,
    attributes: number = 0,
  ): void {
    this.opentui.symbols.bufferDrawChar(buffer, char, x, y, fg.buffer, bg.buffer, attributes)
  }

  public registerNativeSpanFeedStream(stream: Pointer, handler: NativeSpanFeedEventHandler): void {
    const callback = this.ensureNativeSpanFeedCallback()
    this.nativeSpanFeedHandlers.set(Deno.UnsafePointer.value(stream), handler)
    this.opentui.symbols.streamSetCallback(stream, callback.pointer)
  }

  public unregisterNativeSpanFeedStream(stream: Pointer): void {
    this.opentui.symbols.streamSetCallback(stream, null)
    this.nativeSpanFeedHandlers.delete(Deno.UnsafePointer.value(stream))
  }

  public createNativeSpanFeed(options?: NativeSpanFeedOptions | null): Pointer {
    if (!this.opentui.symbols.createNativeSpanFeed) {
      throw new Error("NativeSpanFeed is not supported by this version of the native library")
    }
    const optionsBuffer = options == null ? null : NativeSpanFeedOptionsStruct.pack(options)
    const streamPtr = this.opentui.symbols.createNativeSpanFeed(optionsBuffer ? optionsBuffer : null) as Pointer
    if (!streamPtr) {
      throw new Error("Failed to create stream")
    }
    return streamPtr
  }

  public attachNativeSpanFeed(stream: Pointer): number {
    return this.opentui.symbols.attachNativeSpanFeed(stream)
  }

  public destroyNativeSpanFeed(stream: Pointer): void {
    this.opentui.symbols.destroyNativeSpanFeed(stream)
    this.nativeSpanFeedHandlers.delete(Deno.UnsafePointer.value(stream))
  }

  public streamWrite(stream: Pointer, data: Uint8Array | string): number {
    const bytes = typeof data === "string" ? this.encoder.encode(data) : data
    return this.opentui.symbols.streamWrite(stream, bytes, bytes.length)
  }

  public streamCommit(stream: Pointer): number {
    return this.opentui.symbols.streamCommit(stream)
  }

  public streamDrainSpans(stream: Pointer, outBuffer: Uint8Array, maxSpans: number): number {
    const count = this.opentui.symbols.streamDrainSpans(stream, outBuffer, maxSpans)
    return toNumber(count)
  }

  public streamClose(stream: Pointer): number {
    return this.opentui.symbols.streamClose(stream)
  }

  public streamSetOptions(stream: Pointer, options: NativeSpanFeedOptions): number {
    const optionsBuffer = NativeSpanFeedOptionsStruct.pack(options)
    return this.opentui.symbols.streamSetOptions(stream, optionsBuffer)
  }

  public streamGetStats(stream: Pointer): NativeSpanFeedStats | null {
    const statsBuffer = new Uint8Array(NativeSpanFeedStatsStruct.size)
    const status = this.opentui.symbols.streamGetStats(stream, statsBuffer)
    if (status !== 0) {
      return null
    }
    const stats = NativeSpanFeedStatsStruct.unpack(statsBuffer.buffer)
    return {
      bytesWritten: typeof stats.bytesWritten === "bigint" ? stats.bytesWritten : BigInt(stats.bytesWritten),
      spansCommitted: typeof stats.spansCommitted === "bigint" ? stats.spansCommitted : BigInt(stats.spansCommitted),
      chunks: stats.chunks,
      pendingSpans: stats.pendingSpans,
    }
  }

  public streamReserve(stream: Pointer, minLen: number): { status: number; info: ReserveInfo | null } {
    const reserveBuffer = new Uint8Array(ReserveInfoStruct.size)
    const status = this.opentui.symbols.streamReserve(stream, minLen, reserveBuffer)
    if (status !== 0) {
      return { status, info: null }
    }
    return { status, info: ReserveInfoStruct.unpack(reserveBuffer.buffer) }
  }

  public streamCommitReserved(stream: Pointer, length: number): number {
    return this.opentui.symbols.streamCommitReserved(stream, length)
  }

  public createSyntaxStyle(): Pointer {
    const stylePtr = this.opentui.symbols.createSyntaxStyle()
    if (!stylePtr) {
      throw new Error("Failed to create SyntaxStyle")
    }
    return stylePtr
  }

  public destroySyntaxStyle(style: Pointer): void {
    this.opentui.symbols.destroySyntaxStyle(style)
  }

  public syntaxStyleRegister(
    style: Pointer,
    name: string,
    fg: RGBA | null,
    bg: RGBA | null,
    attributes: number,
  ): number {
    const nameBytes = this.encoder.encode(name)
    const fgPtr = fg ? fg.buffer : null
    const bgPtr = bg ? bg.buffer : null
    return this.opentui.symbols.syntaxStyleRegister(style, nameBytes, nameBytes.length, fgPtr, bgPtr, attributes)
  }

  public syntaxStyleResolveByName(style: Pointer, name: string): number | null {
    const nameBytes = this.encoder.encode(name)
    const id = this.opentui.symbols.syntaxStyleResolveByName(style, nameBytes, nameBytes.length)
    return id === 0 ? null : id
  }

  public syntaxStyleGetStyleCount(style: Pointer): number {
    const result = this.opentui.symbols.syntaxStyleGetStyleCount(style)
    return typeof result === "bigint" ? Number(result) : result
  }

  public editorViewSetPlaceholderStyledText(
    view: Pointer,
    chunks: Array<{ text: string; fg?: RGBA | null; bg?: RGBA | null; attributes?: number }>,
  ): void {
    const nonEmptyChunks = chunks.filter((c) => c.text.length > 0)
    if (nonEmptyChunks.length === 0) {
      this.opentui.symbols.editorViewSetPlaceholderStyledText(view, null, 0)
      return
    }

    const chunksBuffer = StyledChunkStruct.packList(nonEmptyChunks)
    this.opentui.symbols.editorViewSetPlaceholderStyledText(view, chunksBuffer, nonEmptyChunks.length)
  }

  public editorViewSetTabIndicator(view: Pointer, indicator: number): void {
    this.opentui.symbols.editorViewSetTabIndicator(view, indicator)
  }

  public editorViewSetTabIndicatorColor(view: Pointer, color: RGBA): void {
    this.opentui.symbols.editorViewSetTabIndicatorColor(view, color.buffer)
  }

  public onNativeEvent(name: string, handler: (data: ArrayBuffer) => void): void {
    this._nativeEvents.on(name, handler)
  }

  public onceNativeEvent(name: string, handler: (data: ArrayBuffer) => void): void {
    this._nativeEvents.once(name, handler)
  }

  public offNativeEvent(name: string, handler: (data: ArrayBuffer) => void): void {
    this._nativeEvents.off(name, handler)
  }

  public onAnyNativeEvent(handler: (name: string, data: ArrayBuffer) => void): void {
    this._anyEventHandlers.push(handler)
  }
}

let opentuiLibPath: string | undefined
let opentuiLib: RenderLib | undefined

export function setRenderLibPath(libPath: string) {
  if (opentuiLibPath !== libPath) {
    opentuiLibPath = libPath
    opentuiLib = undefined
  }
}

export function resolveRenderLib(): RenderLib {
  if (!opentuiLib) {
    try {
      opentuiLib = new FFIRenderLib(opentuiLibPath)
    } catch (error) {
      throw new Error(
        `Failed to initialize OpenTUI render library: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
    }
  }
  return opentuiLib
}

// Try eager loading
try {
  opentuiLib = new FFIRenderLib(opentuiLibPath)
} catch (error) {}
