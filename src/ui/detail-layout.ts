import { defaultConfig, type DetailLayout } from "../config"

// Share the reading width across detail pages, adding space only for an adjacent sidebar.
export function detailContentWidth(layout: DetailLayout = defaultConfig.detailLayout, sidebarWidth = 0): number | "100%" {
  return layout === "centered" ? 96 + (sidebarWidth > 0 ? sidebarWidth + 2 : 0) : "100%"
}
