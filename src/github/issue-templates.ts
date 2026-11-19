import type { IssueTemplate } from "../models"
import { repositoryPath, type RepositoryReference } from "./repository-target"
import { GitHubApiError, type GitHubTransport, type RequestOptions } from "./transport"

const directory = ".github/ISSUE_TEMPLATE"

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : ""
}

function comment(value: string) {
  return `<!-- ${value.trim().replaceAll("-->", "-- >")} -->`
}

function yamlObject(source: string): Record<string, unknown> | undefined {
  try {
    return object(Bun.YAML.parse(source))
  } catch {
    return undefined
  }
}

export function markdownTemplate(source: string): IssueTemplate | undefined {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source)
  const header = match ? yamlObject(match[1]!) : undefined
  const name = text(header?.name).trim()
  if (!match || !name) return
  return { name, about: text(header?.about).trim(), title: text(header?.title), body: source.slice(match[0].length) }
}

function formElement(value: unknown): string | undefined {
  const element = object(value)
  const attributes = object(element?.attributes)
  if (!element || !attributes) return
  if (element.type === "markdown") return text(attributes.value).trim() ? comment(text(attributes.value)) : undefined
  const label = text(attributes.label).trim()
  if (!label) return
  const required = object(element.validations)?.required === true
  const notes = [
    ...(text(attributes.description).trim() ? [comment(text(attributes.description))] : []),
    ...(text(attributes.placeholder).trim() ? [comment(`placeholder: ${text(attributes.placeholder)}`)] : []),
  ]
  const lines = [`### ${label}`, ""]
  if (element.type === "checkboxes") {
    const options = Array.isArray(attributes.options) ? attributes.options.map(object) : []
    lines.push(
      ...notes,
      ...options
        .filter((option) => text(option?.label).trim())
        .map((option) => `- [ ] ${text(option!.label).trim()}${option!.required === true ? ` ${comment("required")}` : ""}`),
    )
    return lines.join("\n")
  }
  if (required) notes.push(comment("required"))
  if (element.type === "dropdown") {
    const options = Array.isArray(attributes.options) ? attributes.options.map(text).filter((option) => option.trim()) : []
    const selected = typeof attributes.default === "number" ? options[attributes.default] : undefined
    notes.push(comment(`${attributes.multiple === true ? "options (one or more)" : "options"}: ${options.join(", ")}`))
    lines.push(...notes, ...(selected ? [selected] : []))
    return lines.join("\n")
  }
  if (element.type !== "input" && element.type !== "textarea" && element.type !== "upload") return
  const answer = text(attributes.value)
  const render = element.type === "textarea" ? text(attributes.render).trim() : ""
  lines.push(...notes, ...(render ? ["```" + render, answer, "```"] : answer ? [answer] : []))
  return lines.join("\n")
}

export function formTemplate(source: string): IssueTemplate | undefined {
  const form = yamlObject(source)
  const name = text(form?.name).trim()
  if (!form || !name || !Array.isArray(form.body)) return
  return {
    name,
    about: text(form.description).trim(),
    title: text(form.title),
    body: form.body
      .map(formElement)
      .filter((section) => section !== undefined)
      .join("\n\n"),
  }
}

export function createGitHubIssueTemplates(transport: GitHubTransport) {
  return async function issueTemplates(repository: RepositoryReference, options?: RequestOptions): Promise<IssueTemplate[]> {
    const base = repositoryPath(repository)
    let entries: unknown
    try {
      entries = await transport.json<unknown>(`${base}/contents/${directory}`, options)
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return []
      throw error
    }
    const files = (Array.isArray(entries) ? entries.map(object) : [])
      .filter((entry) => entry?.type === "file" && typeof entry.name === "string" && entry.path === `${directory}/${entry.name}`)
      .map((entry) => entry!.name as string)
      .filter((name) => /\.(md|ya?ml)$/i.test(name) && !/^config\.ya?ml$/i.test(name) && !/[\\/\x00-\x1f\x7f]/.test(name))
      .sort((a, b) => a.localeCompare(b))
    const templates = await Promise.all(
      files.map(async (filename) => {
        const source = await transport.text(
          `${base}/contents/${directory}/${encodeURIComponent(filename)}`,
          "application/vnd.github.raw+json",
          { ...options, maxBytes: 1024 * 1024 },
        )
        return /\.md$/i.test(filename) ? markdownTemplate(source) : formTemplate(source)
      }),
    )
    return templates.filter((template) => template !== undefined)
  }
}
