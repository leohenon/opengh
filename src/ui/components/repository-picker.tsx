import { TextAttributes } from "@opentui/core"
import type { PullRepository } from "../../models"
import { useTheme } from "../theme"
import { SearchablePicker } from "./searchable-picker"

const match = (value: string, query: string) => {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const index = value.toLowerCase().indexOf(needle)
  return index < 0 ? undefined : index
}

export function RepositoryPicker(props: {
  title: string
  repositories: PullRepository[]
  current: PullRepository
  showScrollbar: boolean
  zIndex?: number
  onSelect(repository: PullRepository): void
  onClose(): void
}) {
  const { colors } = useTheme()
  return (
    <SearchablePicker
      title={props.title}
      placeholder="Search repositories"
      items={props.repositories}
      itemKey={(repository) => repository.id}
      match={(repository, needle) => match(repository.nameWithOwner, needle)}
      preferred={(repository) => repository.id === props.current.id}
      height={Math.min(22, props.repositories.length + 8)}
      width={Math.min(
        100,
        Math.max(
          64,
          ...props.repositories.map((repository) => Bun.stringWidth(`${repository.nameWithOwner}  ${repository.defaultBranch}`) + 22),
        ),
      )}
      zIndex={props.zIndex}
      showScrollbar={props.showScrollbar}
      empty="No matching repositories"
      onSelect={props.onSelect}
      onClose={props.onClose}
    >
      {(repository, active) => (
        <>
          <box height={1} flexGrow={1} flexBasis={0} flexShrink={1} minWidth={0} overflow="hidden" flexDirection="row">
            <text
              height={1}
              flexShrink={1}
              minWidth={0}
              wrapMode="none"
              truncate
              fg={active() ? colors.blue : colors.text}
              attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
            >
              {repository.nameWithOwner}
            </text>
            <text height={1} flexShrink={0} maxWidth="40%" wrapMode="none" truncate fg={colors.muted}>
              {`  ${repository.defaultBranch}`}
            </text>
          </box>
          <text width={10} flexShrink={0} marginLeft={1} fg={colors.green}>
            {repository.id === props.current.id ? "✓ selected" : ""}
          </text>
        </>
      )}
    </SearchablePicker>
  )
}
