import { RGBA } from "./lib/RGBA"

// Re-export Pointer type for Deno FFI
export type Pointer = Deno.PointerObject

// --- Type info helpers ---

function getTypeInfo(type: string | string[]): { size: number; align: number } {
  if (Array.isArray(type)) return { size: 8, align: 8 } // pointer to array
  switch (type) {
    case "u8":
    case "i8":
    case "bool_u8":
      return { size: 1, align: 1 }
    case "u16":
    case "i16":
      return { size: 2, align: 2 }
    case "u32":
    case "i32":
    case "f32":
      return { size: 4, align: 4 }
    case "u64":
    case "i64":
    case "f64":
      return { size: 8, align: 8 }
    case "pointer":
    case "char*":
      return { size: 8, align: 8 }
    default:
      throw new Error(`Unknown type: ${type}`)
  }
}

function alignTo(offset: number, alignment: number): number {
  return (offset + alignment - 1) & ~(alignment - 1)
}

// --- Enum definition ---

interface EnumDef {
  __enumDef: true
  baseType: string
  forward: Record<string, number>
  reverse: Record<number, string>
}

function defineEnum(mapping: Record<string, number>, baseType: string): EnumDef {
  const reverse: Record<number, string> = {}
  for (const [key, val] of Object.entries(mapping)) {
    reverse[val] = key
  }
  return { __enumDef: true, baseType, forward: mapping, reverse }
}

// --- Struct definition ---

type FieldOptions = {
  lengthOf?: string
  optional?: boolean
  default?: any
  packTransform?: (val: any) => any
  unpackTransform?: (val: any) => any
}

type FieldDef = [string, string | string[] | EnumDef] | [string, string | string[] | EnumDef, FieldOptions]

type StructOptions = {
  reduceValue?: (val: any) => any
}

interface FieldLayout {
  name: string
  type: string | string[] | EnumDef
  offset: number
  size: number
  align: number
  options: FieldOptions
}

function defineStruct(fields: FieldDef[], structOptions?: StructOptions) {
  const layout: FieldLayout[] = []
  let offset = 0
  let maxAlign = 1

  for (const field of fields) {
    const name = field[0] as string
    const type = field[1]
    const options: FieldOptions = (field.length > 2 ? field[2] : {}) as FieldOptions

    let info: { size: number; align: number }
    if (typeof type === "object" && !Array.isArray(type) && "__enumDef" in type) {
      info = getTypeInfo(type.baseType)
    } else {
      info = getTypeInfo(type as string | string[])
    }

    offset = alignTo(offset, info.align)
    layout.push({ name, type, offset, size: info.size, align: info.align, options })
    offset += info.size
    maxAlign = Math.max(maxAlign, info.align)
  }

  const size = alignTo(offset, maxAlign)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  function writeField(view: DataView, offset: number, resolvedType: string | string[], value: any): void {
    if (value === null || value === undefined) return

    if (Array.isArray(resolvedType)) {
      const ptr = Deno.UnsafePointer.of(value as ArrayBufferView)
      view.setBigUint64(offset, ptr ? Deno.UnsafePointer.value(ptr) : 0n, true)
      return
    }

    switch (resolvedType) {
      case "u8":
      case "i8":
        view.setUint8(offset, Number(value) & 0xff)
        break
      case "bool_u8":
        view.setUint8(offset, value ? 1 : 0)
        break
      case "u16":
      case "i16":
        view.setUint16(offset, Number(value) & 0xffff, true)
        break
      case "u32":
        view.setUint32(offset, Number(value) >>> 0, true)
        break
      case "i32":
        view.setInt32(offset, Number(value), true)
        break
      case "f32":
        view.setFloat32(offset, Number(value), true)
        break
      case "u64":
        view.setBigUint64(offset, BigInt(value), true)
        break
      case "i64":
        view.setBigInt64(offset, BigInt(value), true)
        break
      case "f64":
        view.setFloat64(offset, Number(value), true)
        break
      case "pointer":
      case "char*": {
        if (value && typeof value === "object") {
          view.setBigUint64(offset, Deno.UnsafePointer.value(value as Deno.PointerObject), true)
        }
        break
      }
    }
  }

  function readScalar(view: DataView, offset: number, type: string): number | bigint {
    switch (type) {
      case "u8":
      case "bool_u8":
        return view.getUint8(offset)
      case "i8":
        return view.getInt8(offset)
      case "u16":
        return view.getUint16(offset, true)
      case "i16":
        return view.getInt16(offset, true)
      case "u32":
        return view.getUint32(offset, true)
      case "i32":
        return view.getInt32(offset, true)
      case "f32":
        return view.getFloat32(offset, true)
      case "u64":
        return view.getBigUint64(offset, true)
      case "i64":
        return view.getBigInt64(offset, true)
      case "f64":
        return view.getFloat64(offset, true)
      default:
        return 0
    }
  }

  function packOne(view: DataView, baseOffset: number, obj: any): void {
    // Pre-encode char* and array fields
    const encodedStrings: Record<string, { bytes: Uint8Array; ptr: Deno.PointerValue }> = {}
    const encodedArrays: Record<string, { typed: ArrayBufferView; count: number }> = {}

    for (const f of layout) {
      if (f.type === "char*") {
        const text = obj[f.name]
        if (text != null && text !== "") {
          const bytes = encoder.encode(text)
          encodedStrings[f.name] = { bytes, ptr: Deno.UnsafePointer.of(bytes) }
        }
      } else if (Array.isArray(f.type)) {
        const arr = obj[f.name]
        if (arr != null && Array.isArray(arr)) {
          const elemType = (f.type as string[])[0]
          let typed: ArrayBufferView
          switch (elemType) {
            case "u32":
              typed = new Uint32Array(arr)
              break
            case "u16":
              typed = new Uint16Array(arr)
              break
            case "u8":
              typed = new Uint8Array(arr)
              break
            case "f32":
              typed = new Float32Array(arr)
              break
            default:
              typed = new Uint32Array(arr)
              break
          }
          encodedArrays[f.name] = { typed, count: arr.length }
        }
      }
    }

    for (const f of layout) {
      const absOffset = baseOffset + f.offset
      let value = obj[f.name]

      // Length field: compute from associated field
      if (f.options.lengthOf) {
        const target = f.options.lengthOf
        if (encodedStrings[target]) {
          value = encodedStrings[target].bytes.byteLength
        } else if (encodedArrays[target]) {
          value = encodedArrays[target].count
        } else {
          value = 0
        }
      }

      // Apply default
      if (value === undefined || value === null) {
        if (f.options.default !== undefined) {
          value = f.options.default
        } else if (f.options.optional) {
          value = null
        }
      }

      // Apply packTransform
      if (f.options.packTransform) {
        value = f.options.packTransform(value)
      }

      // Resolve type (handle enums)
      let resolvedType: string | string[]
      if (typeof f.type === "object" && !Array.isArray(f.type) && "__enumDef" in f.type) {
        const enumDef = f.type as EnumDef
        if (typeof value === "string") {
          value = enumDef.forward[value] ?? 0
        }
        resolvedType = enumDef.baseType
      } else {
        resolvedType = f.type as string | string[]
      }

      // Handle char* → write pointer
      if (resolvedType === "char*") {
        const enc = encodedStrings[f.name]
        value = enc ? enc.ptr : null
      }

      // Handle array → write pointer to typed array
      if (Array.isArray(resolvedType)) {
        const enc = encodedArrays[f.name]
        value = enc ? enc.typed : null
      }

      writeField(view, absOffset, resolvedType, value)
    }
  }

  function unpackOne(view: DataView, baseOffset: number): any {
    const result: any = {}

    // First pass: read length fields
    const lengthValues: Record<string, number> = {}
    for (const f of layout) {
      if (f.options.lengthOf) {
        const absOffset = baseOffset + f.offset
        const baseType =
          typeof f.type === "object" && !Array.isArray(f.type) && "__enumDef" in f.type
            ? (f.type as EnumDef).baseType
            : (f.type as string)
        const val = readScalar(view, absOffset, baseType)
        lengthValues[f.options.lengthOf] = Number(val)
      }
    }

    for (const f of layout) {
      // Skip length fields in output
      if (f.options.lengthOf) continue

      const absOffset = baseOffset + f.offset

      // Handle enum
      if (typeof f.type === "object" && !Array.isArray(f.type) && "__enumDef" in f.type) {
        const enumDef = f.type as EnumDef
        const numVal = Number(readScalar(view, absOffset, enumDef.baseType))
        result[f.name] = enumDef.reverse[numVal] ?? numVal
        continue
      }

      // Handle char*
      if (f.type === "char*") {
        const ptrBigInt = view.getBigUint64(absOffset, true)
        const length = lengthValues[f.name] ?? 0
        if (ptrBigInt !== 0n && length > 0) {
          const ptr = Deno.UnsafePointer.create(ptrBigInt)!
          const buf = Deno.UnsafePointerView.getArrayBuffer(ptr, length)
          result[f.name] = decoder.decode(new Uint8Array(buf))
        } else {
          result[f.name] = ""
        }
        continue
      }

      // Handle array types
      if (Array.isArray(f.type)) {
        const ptrBigInt = view.getBigUint64(absOffset, true)
        const count = lengthValues[f.name] ?? 0
        if (ptrBigInt !== 0n && count > 0) {
          const ptr = Deno.UnsafePointer.create(ptrBigInt)!
          const elemType = (f.type as string[])[0]
          const elemSize = getTypeInfo(elemType).size
          const buf = Deno.UnsafePointerView.getArrayBuffer(ptr, count * elemSize)
          switch (elemType) {
            case "u32":
              result[f.name] = Array.from(new Uint32Array(buf))
              break
            case "u16":
              result[f.name] = Array.from(new Uint16Array(buf))
              break
            case "u8":
              result[f.name] = Array.from(new Uint8Array(buf))
              break
            case "f32":
              result[f.name] = Array.from(new Float32Array(buf))
              break
            default:
              result[f.name] = Array.from(new Uint32Array(buf))
              break
          }
        } else {
          result[f.name] = []
        }
        continue
      }

      // Handle pointer
      if (f.type === "pointer") {
        const ptrBigInt = view.getBigUint64(absOffset, true)
        const ptrObj = ptrBigInt !== 0n ? Deno.UnsafePointer.create(ptrBigInt) : null
        if (f.options.unpackTransform) {
          result[f.name] = f.options.unpackTransform(ptrObj)
        } else {
          result[f.name] = ptrObj
        }
        continue
      }

      // Handle bool_u8
      if (f.type === "bool_u8") {
        result[f.name] = view.getUint8(absOffset) !== 0
        continue
      }

      // Scalar types
      result[f.name] = readScalar(view, absOffset, f.type as string)
    }

    return result
  }

  return {
    size,

    pack(obj: any): ArrayBuffer {
      const buffer = new ArrayBuffer(size)
      const view = new DataView(buffer)
      packOne(view, 0, obj)
      return buffer
    },

    packList(items: any[]): ArrayBuffer {
      const buffer = new ArrayBuffer(size * items.length)
      const view = new DataView(buffer)
      for (let i = 0; i < items.length; i++) {
        packOne(view, i * size, items[i])
      }
      return buffer
    },

    unpack(buffer: ArrayBuffer): any {
      const view = new DataView(buffer)
      const raw = unpackOne(view, 0)
      return structOptions?.reduceValue ? structOptions.reduceValue(raw) : raw
    },

    unpackList(buffer: ArrayBuffer, count: number): any[] {
      const view = new DataView(buffer)
      const results: any[] = []
      for (let i = 0; i < count; i++) {
        const raw = unpackOne(view, i * size)
        results.push(structOptions?.reduceValue ? structOptions.reduceValue(raw) : raw)
      }
      return results
    },
  }
}

// --- RGBA pack/unpack transforms ---

const rgbaPackTransform = (rgba?: RGBA) => (rgba ? Deno.UnsafePointer.of(rgba.buffer) : null)
const rgbaUnpackTransform = (ptr?: Deno.PointerObject | null) => {
  if (!ptr) return undefined
  return RGBA.fromArray(new Float32Array(Deno.UnsafePointerView.getArrayBuffer(ptr, 16)))
}

// --- Struct definitions ---

export const StyledChunkStruct = defineStruct([
  ["text", "char*"],
  ["text_len", "u64", { lengthOf: "text" }],
  [
    "fg",
    "pointer",
    {
      optional: true,
      packTransform: rgbaPackTransform,
      unpackTransform: rgbaUnpackTransform,
    },
  ],
  [
    "bg",
    "pointer",
    {
      optional: true,
      packTransform: rgbaPackTransform,
      unpackTransform: rgbaUnpackTransform,
    },
  ],
  ["attributes", "u32", { optional: true }],
])

export const HighlightStruct = defineStruct([
  ["start", "u32"],
  ["end", "u32"],
  ["styleId", "u32"],
  ["priority", "u8", { default: 0 }],
  ["hlRef", "u16", { default: 0 }],
])

export const LogicalCursorStruct = defineStruct([
  ["row", "u32"],
  ["col", "u32"],
  ["offset", "u32"],
])

export const VisualCursorStruct = defineStruct([
  ["visualRow", "u32"],
  ["visualCol", "u32"],
  ["logicalRow", "u32"],
  ["logicalCol", "u32"],
  ["offset", "u32"],
])

const UnicodeMethodEnum = defineEnum({ wcwidth: 0, unicode: 1 }, "u8")

export const TerminalCapabilitiesStruct = defineStruct([
  ["kitty_keyboard", "bool_u8"],
  ["kitty_graphics", "bool_u8"],
  ["rgb", "bool_u8"],
  ["unicode", UnicodeMethodEnum],
  ["sgr_pixels", "bool_u8"],
  ["color_scheme_updates", "bool_u8"],
  ["explicit_width", "bool_u8"],
  ["scaled_text", "bool_u8"],
  ["sixel", "bool_u8"],
  ["focus_tracking", "bool_u8"],
  ["sync", "bool_u8"],
  ["bracketed_paste", "bool_u8"],
  ["hyperlinks", "bool_u8"],
  ["osc52", "bool_u8"],
  ["explicit_cursor_positioning", "bool_u8"],
  ["term_name", "char*"],
  ["term_name_len", "u64", { lengthOf: "term_name" }],
  ["term_version", "char*"],
  ["term_version_len", "u64", { lengthOf: "term_version" }],
  ["term_from_xtversion", "bool_u8"],
])

export const EncodedCharStruct = defineStruct([
  ["width", "u8"],
  ["char", "u32"],
])

export const LineInfoStruct = defineStruct([
  ["starts", ["u32"]],
  ["startsLen", "u32", { lengthOf: "starts" }],
  ["widths", ["u32"]],
  ["widthsLen", "u32", { lengthOf: "widths" }],
  ["sources", ["u32"]],
  ["sourcesLen", "u32", { lengthOf: "sources" }],
  ["wraps", ["u32"]],
  ["wrapsLen", "u32", { lengthOf: "wraps" }],
  ["maxWidth", "u32"],
])

export const MeasureResultStruct = defineStruct([
  ["lineCount", "u32"],
  ["maxWidth", "u32"],
])

export const CursorStateStruct = defineStruct([
  ["x", "u32"],
  ["y", "u32"],
  ["visible", "bool_u8"],
  ["style", "u8"],
  ["blinking", "bool_u8"],
  ["r", "f32"],
  ["g", "f32"],
  ["b", "f32"],
  ["a", "f32"],
])

export type GrowthPolicy = "grow" | "block"

export type NativeSpanFeedOptions = {
  chunkSize?: number
  initialChunks?: number
  maxBytes?: bigint
  growthPolicy?: GrowthPolicy
  autoCommitOnFull?: boolean
  spanQueueCapacity?: number
}

export type NativeSpanFeedStats = {
  bytesWritten: bigint
  spansCommitted: bigint
  chunks: number
  pendingSpans: number
}

export type SpanInfo = {
  chunkPtr: Pointer
  offset: number
  len: number
  chunkIndex: number
}

export type ReserveInfo = {
  ptr: Pointer
  len: number
}

const GrowthPolicyEnum = defineEnum({ grow: 0, block: 1 }, "u8")

export const NativeSpanFeedOptionsStruct = defineStruct([
  ["chunkSize", "u32", { default: 64 * 1024 }],
  ["initialChunks", "u32", { default: 2 }],
  ["maxBytes", "u64", { default: 0n }],
  ["growthPolicy", GrowthPolicyEnum, { default: "grow" }],
  ["autoCommitOnFull", "bool_u8", { default: true }],
  ["spanQueueCapacity", "u32", { default: 0 }],
])

export const NativeSpanFeedStatsStruct = defineStruct([
  ["bytesWritten", "u64"],
  ["spansCommitted", "u64"],
  ["chunks", "u32"],
  ["pendingSpans", "u32"],
])

export const SpanInfoStruct = defineStruct(
  [
    ["chunkPtr", "pointer"],
    ["offset", "u32"],
    ["len", "u32"],
    ["chunkIndex", "u32"],
    ["reserved", "u32", { default: 0 }],
  ],
  {
    reduceValue: (value: { chunkPtr: Pointer; offset: number; len: number; chunkIndex: number }) => ({
      chunkPtr: value.chunkPtr as Pointer,
      offset: value.offset,
      len: value.len,
      chunkIndex: value.chunkIndex,
    }),
  },
)

export const ReserveInfoStruct = defineStruct(
  [
    ["ptr", "pointer"],
    ["len", "u32"],
    ["reserved", "u32", { default: 0 }],
  ],
  {
    reduceValue: (value: { ptr: Pointer; len: number }) => ({
      ptr: value.ptr as Pointer,
      len: value.len,
    }),
  },
)
