import { sql } from "./client"

export interface UserSettings {
  canvas_height: number
  tabs_visible: boolean
}

const DEFAULT_CANVAS_HEIGHT = 1440
const DEFAULT_TABS_VISIBLE = true

export type UserSettingsUpdate = Partial<UserSettings>

export const settingsDb = {
  get: async (userId: string): Promise<UserSettings> => {
    const rows = await sql<UserSettings[]>`
      SELECT canvas_height, tabs_visible FROM user_settings WHERE user_id = ${userId}
    `

    // Returning the default without inserting keeps reads free of surprising writes.
    return rows[0] ?? {
      canvas_height: DEFAULT_CANVAS_HEIGHT,
      tabs_visible: DEFAULT_TABS_VISIBLE,
    }
  },

  update: async (userId: string, update: UserSettingsUpdate): Promise<UserSettings> => {
    const canvasHeight = update.canvas_height ?? null
    const tabsVisible = update.tabs_visible ?? null
    const rows = await sql<UserSettings[]>`
      INSERT INTO user_settings (user_id, canvas_height, tabs_visible)
      VALUES (
        ${userId},
        COALESCE(${canvasHeight}::integer, ${DEFAULT_CANVAS_HEIGHT}),
        COALESCE(${tabsVisible}::boolean, ${DEFAULT_TABS_VISIBLE})
      )
      ON CONFLICT (user_id) DO UPDATE SET
        canvas_height = COALESCE(${canvasHeight}::integer, user_settings.canvas_height),
        tabs_visible = COALESCE(${tabsVisible}::boolean, user_settings.tabs_visible),
        updated_at = NOW()
      RETURNING canvas_height, tabs_visible
    `
    const settings = rows[0]
    if (!settings) throw new Error("Failed to save user settings")
    return settings
  },
}
