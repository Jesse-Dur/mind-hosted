import { create } from "zustand"
import { createAiSlice } from "./aiSlice"
import { createBootSlice } from "./bootSlice"
import { createCanvasDataSlice } from "./canvasDataSlice"
import { createCanvasSlice } from "./canvasSlice"
import { createHistorySlice } from "./historySlice"
import { createTagSlice } from "./tagSlice"
import { createThoughtSlice } from "./thoughtSlice"
import { createTileSlice } from "./tileSlice"
import { createSyncSlice } from "./syncSlice"
import { createUiSlice } from "./uiSlice"
import { registerSyncStore } from "../sync/storeBridge"
import type { AppStore } from "./types"

export const useStore = create<AppStore>((set, get, store) => ({
  // One public store keeps cross-slice updates atomic while each file owns one domain.
  ...createBootSlice(set, get, store),
  ...createCanvasSlice(set, get, store),
  ...createCanvasDataSlice(set, get, store),
  ...createTileSlice(set, get, store),
  ...createThoughtSlice(set, get, store),
  ...createTagSlice(set, get, store),
  ...createHistorySlice(set, get, store),
  ...createAiSlice(set, get, store),
  ...createSyncSlice(set, get, store),
  ...createUiSlice(set, get, store),
}))

registerSyncStore(() => useStore.getState(), (updater) => useStore.setState(updater))

export { setGetToken } from "./apiAuth"
export type { AiStatus, AppStore } from "./types"
