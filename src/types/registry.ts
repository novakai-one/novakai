// Component registry — maps each block component name to its React component.
// The NAME set is owned by ComponentName in types.ts; `satisfies` below checks
// this map covers exactly those names, so adding a component to one without the
// other fails to compile. (The map can't be the type source: it imports the
// components, which import types.ts — deriving the union there would cycle.)

import type { ComponentName } from "./types"
import CanvasArea from "../components/blocks/CanvasArea/CanvasArea"
import ContentArea from "../components/blocks/ContentArea/ContentArea"
import DatabaseArea from "../components/blocks/DatabaseArea/DatabaseArea"

export const COMPONENT_REGISTRY = {
    ContentArea,
    CanvasArea,
    DatabaseArea,
} as const satisfies Record<ComponentName, unknown>

export type ComponentRegistryKey = keyof typeof COMPONENT_REGISTRY
