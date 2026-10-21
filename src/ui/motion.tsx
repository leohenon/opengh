import { createContext, createEffect, createSignal, onCleanup, useContext, type Accessor, type ParentProps } from "solid-js"
import { defaultConfig } from "../config"

const MotionContext = createContext<Accessor<boolean>>(() => defaultConfig.reducedMotion)
const frames = ["◐", "◓", "◑", "◒"] as const

export function MotionProvider(props: ParentProps<{ reduced: boolean }>) {
  return <MotionContext.Provider value={() => props.reduced}>{props.children}</MotionContext.Provider>
}

export function useLoadingGlyph(active: Accessor<boolean>) {
  const reduced = useContext(MotionContext)
  const [frame, setFrame] = createSignal(0)
  createEffect(() => {
    if (!active() || reduced()) return
    const timer = setInterval(() => setFrame((value) => (value + 1) % frames.length), 125)
    onCleanup(() => clearInterval(timer))
  })
  return () => reduced() ? frames[0] : frames[frame()]
}
