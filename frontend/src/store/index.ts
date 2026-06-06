import { create } from "zustand"
import { createAiSlice } from "./aiSlice"
import { createCanvasDataSlice } from "./canvasDataSlice"
import { createCanvasSlice } from "./canvasSlice"
import { createTagSlice } from "./tagSlice"
import { createThoughtSlice } from "./thoughtSlice"
import { createTileSlice } from "./tileSlice"
import { createUiSlice } from "./uiSlice"
import type { AppStore } from "./types"

export const useStore = create<AppStore>((set, get, store) => ({
  // One public store keeps cross-slice updates atomic while each file owns one domain.
  ...createCanvasSlice(set, get, store),
  ...createCanvasDataSlice(set, get, store),
  ...createTileSlice(set, get, store),
  ...createThoughtSlice(set, get, store),
  ...createTagSlice(set, get, store),
  ...createAiSlice(set, get, store),
  ...createUiSlice(set, get, store),
}))

export { setGetToken } from "./apiAuth"
export type { AiStatus, AppStore } from "./types"
