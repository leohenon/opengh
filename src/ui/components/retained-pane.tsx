import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"

export const PaneVisible = createContext<Accessor<boolean>>(() => true)

export function RetainedPane(props: ParentProps<{ visible: boolean }>) {
  const surfaceVisible = useContext(PaneVisible)
  return (
    <PaneVisible.Provider value={() => surfaceVisible() && props.visible}>
      <box visible={props.visible} flexGrow={1} minHeight={0}>
        {props.children}
      </box>
    </PaneVisible.Provider>
  )
}
