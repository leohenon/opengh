import { createContext, createMemo, useContext, type Accessor, type ParentProps } from "solid-js"
import { defaultConfig, type IconStyle } from "../config"
import { nerdIcons, noIcons, unicodeIcons, type IconSet } from "./icons"

const iconSets: Record<IconStyle, IconSet> = { nerd: nerdIcons, unicode: unicodeIcons, none: noIcons }
const IconContext = createContext<Accessor<IconSet>>(() => iconSets[defaultConfig.iconStyle])

export function IconProvider(props: ParentProps<{ style: IconStyle }>) {
  const icons = createMemo(() => iconSets[props.style])
  return <IconContext.Provider value={icons}>{props.children}</IconContext.Provider>
}

export function useIcons() {
  return useContext(IconContext)
}
