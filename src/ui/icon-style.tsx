import { createContext, createMemo, useContext, type Accessor, type ParentProps } from "solid-js"
import { defaultConfig, type IconStyle } from "../config"
import { nerdIcons, unicodeIcons, type IconSet } from "./icons"

const IconContext = createContext<Accessor<IconSet>>(() => defaultConfig.iconStyle === "nerd" ? nerdIcons : unicodeIcons)

export function IconProvider(props: ParentProps<{ style: IconStyle }>) {
  const icons = createMemo(() => props.style === "nerd" ? nerdIcons : unicodeIcons)
  return <IconContext.Provider value={icons}>{props.children}</IconContext.Provider>
}

export function useIcons() {
  return useContext(IconContext)
}
