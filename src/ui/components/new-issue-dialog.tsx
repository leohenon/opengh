import type { ComposeDraft } from "../../compose-drafts"
import type { IssueDetail } from "../../models"
import { ComposeDialog } from "./compose-dialog"

export function NewIssueDialog(props: {
  repository: string
  repositoryUrl: string
  defaultBranch?: string
  showScrollbar: boolean
  draft: ComposeDraft
  draftError?: string
  showStatusBarHints?: boolean
  onDraftChange(draft: ComposeDraft): void
  onSubmit?(title: string, body: string): Promise<IssueDetail>
  onClose(): void
  onHintChange(hint: string | undefined): void
}) {
  return (
    <ComposeDialog
      idPrefix="new-issue"
      heading="New issue"
      confirmation={`Create issue in ${props.repository}?`}
      repositoryUrl={props.repositoryUrl}
      defaultBranch={props.defaultBranch}
      showScrollbar={props.showScrollbar}
      draft={props.draft}
      draftError={props.draftError}
      showStatusBarHints={props.showStatusBarHints}
      onDraftChange={props.onDraftChange}
      onSubmit={props.onSubmit}
      onClose={props.onClose}
      onHintChange={props.onHintChange}
    />
  )
}
