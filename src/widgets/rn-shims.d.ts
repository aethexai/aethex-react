/* eslint-disable @typescript-eslint/naming-convention -- mirrors external (Skia) API names */
// Ambient shims for the React-Native-only peer deps used by the native widgets
// (AethexVoiceOrb.native). They let the SDK type-check + build without a full
// react-native / skia install; the consumer's app provides the real ones, and
// web bundles never import these files (resolved only under the Metro
// `react-native` condition). Loose `any`-ish types on purpose.
declare module "react-native" {
  import type { ComponentType, ReactNode } from "react"
  export const View: ComponentType<Record<string, unknown> & { children?: ReactNode }>
  export const Text: ComponentType<Record<string, unknown> & { children?: ReactNode }>
  export const Pressable: ComponentType<Record<string, unknown> & { children?: ReactNode }>
  export const StyleSheet: {
    create<T extends Record<string, unknown>>(styles: T): T
    flatten(style?: unknown): Record<string, unknown>
  }
  export type StyleProp<T> = T | T[] | null | undefined | false
  export type ViewStyle = Record<string, unknown>
  export type TextStyle = Record<string, unknown>
}

declare module "@shopify/react-native-skia" {
  import type { ComponentType, ReactNode } from "react"
  export interface SkImage {
    readonly __skimage?: never
  }
  export const Canvas: ComponentType<{ style?: unknown; children?: ReactNode }>
  export const Group: ComponentType<{ clip?: unknown; children?: ReactNode }>
  export const Image: ComponentType<Record<string, unknown>>
  export const Rect: ComponentType<Record<string, unknown>>
  export const Skia: {
    Data: { fromBytes(bytes: Uint8Array): unknown }
    Image: { MakeImage(info: unknown, data: unknown, bytesPerRow: number): SkImage | null }
  }
  export function rect(x: number, y: number, width: number, height: number): unknown
  export function rrect(r: unknown, rx: number, ry: number): unknown
  export const FilterMode: { Nearest: number; Linear: number }
  export const MipmapMode: { None: number; Linear: number }
  export const ColorType: { RGBA_8888: number }
  export const AlphaType: { Opaque: number; Unpremul: number; Premul: number }
}
