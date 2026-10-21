import { defaultConfig, type DetailLayout } from "../config"

export const READING_WIDTH = 84

// Share the reading width across detail pages, adding space only for an adjacent sidebar.
export function detailContentWidth(layout: DetailLayout = defaultConfig.detailLayout, sidebarWidth = 0): number | "100%" {
  return layout === "centered" ? READING_WIDTH + (sidebarWidth > 0 ? sidebarWidth + 2 : 0) : "100%"
}
