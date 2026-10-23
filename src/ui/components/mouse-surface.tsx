import type { JSX } from "solid-js"
import { mouseSurface } from "../mouse"

export function MouseSurface(props: { children: JSX.Element }) {
  const mouse = mouseSurface()
  return <box {...mouse} width="100%" height="100%" flexDirection="column">{props.children}</box>
}
