import type { Repo, RepositoryDocument } from "../models"
import { GitHubApiError, type GitHubTransport, type RequestOptions } from "./transport"
import { RequestBudgetLimitError } from "./request-budget"
import { repositoryName, repositoryPath, type RepositoryReference } from "./repository-target"

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function repoPart(value: unknown): value is string {
  return nonempty(value) && /^[a-z\d_.-]+$/i.test(value) && value !== "." && value !== ".."
}

function filePath(value: unknown): value is string {
  return nonempty(value) && !/[\\\x00-\x1f\x7f]/.test(value)
    && value.split("/").every(part => part !== "" && part !== "." && part !== "..")
}

function source(repository: string, ref: string, path: string, label: string): RepositoryDocument {
  return { id: `${repository}:${path}`, label, repository, ref, path }
}

function licenseLabel(label: string) {
  return /\blicense$/i.test(label) ? label : `${label} license`
}

function overviewDocuments(html: string, repo: Repo, branch: string): RepositoryDocument[] | undefined {
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = new Map<string, string>()
    for (const attr of script[1]!.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
      attributes.set(attr[1]!.toLowerCase(), attr[3]!)
    }
    if (attributes.get("type") !== "application/json"
      || attributes.get("data-target") !== "react-app.embeddedData") continue
    let data: unknown
    try { data = JSON.parse(script[2]!) } catch { continue }
    const payload = object(object(data)?.payload)
    // Anonymous name-based pages are only authoritative for this exact repo.
    if (object(object(payload?.codeViewLayoutRoute)?.repo)?.id !== repo.id) continue
    for (const key of ["codeViewRepoRoute", "codeViewTreeRoute"]) {
      const route = object(payload?.[key])
      if (!route || (route.path !== "" && route.path !== "/") || object(route.refInfo)?.name !== branch) continue
      const files = object(route.overview)?.overviewFiles
      if (!Array.isArray(files)) continue
      const documents: RepositoryDocument[] = []
      let valid = true
      for (const value of files) {
        const file = object(value)
        if (!file || !repoPart(file.repoName) || !filePath(file.path)
          || !nonempty(file.refName) || !nonempty(file.tabName)
          || !nonempty(file.preferredFileType) || !nonempty(file.displayName)) {
          valid = false
          break
        }
        const repository = `${repo.nameWithOwner.split("/")[0]}/${file.repoName}`
        documents.push(source(repository, file.refName, file.path,
          file.preferredFileType === "license" ? licenseLabel(file.tabName) : file.tabName))
      }
      if (valid) return documents
    }
  }
  return undefined
}

const prose = [
  ["code_of_conduct", "Code of conduct"],
  ["contributing", "Contributing"],
  ["security", "Security"],
  ["accessibility", "Accessibility"],
] as const

function proseName(name: string) {
  return name.toLowerCase().replace(/\.(md|markdown|rst|txt)$/, "")
}

export function createGitHubDocuments(transport: GitHubTransport) {
  async function optional(path: string, options?: RequestOptions): Promise<unknown> {
    try {
      return await transport.json<unknown>(path, options)
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return undefined
      throw error
    }
  }

  async function fallback(repo: RepositoryReference, branch: string, options?: RequestOptions): Promise<RepositoryDocument[]> {
    const base = repositoryPath(repo)
    const query = `?ref=${encodeURIComponent(branch)}`
    const [readme, license] = await Promise.all([
      optional(`${base}/readme${query}`, options).then(object),
      optional(`${base}/license${query}`, options).then(object),
    ])
    const documents: RepositoryDocument[] = []
    const add = (path: string, label: string) => {
      if (!documents.some(document => document.path === path)) {
        documents.push(source(repositoryName(repo), branch, path, label))
      }
    }
    if (filePath(readme?.path)) add(readme.path, "README")
    const spdx = object(license?.license)?.spdx_id
    const label = nonempty(spdx) && spdx !== "NOASSERTION" ? licenseLabel(spdx) : "License"
    const hasLicense = filePath(license?.path)
    const selected = new Map<string, string>()
    let licensePaths: string[] = []
    for (const directory of [".github", "", "docs"]) {
      const entries = await optional(`${base}/contents/${directory}${query}`, options)
      if (!Array.isArray(entries)) continue
      const files = entries.map(object).filter(entry => entry?.type === "file"
        && nonempty(entry.name) && filePath(entry.path)
        && entry.path === (directory ? `${directory}/${entry.name}` : entry.name))
      for (const [name] of prose) {
        const entry = files.find(file => proseName(file!.name as string) === name)
        if (entry && !selected.has(name)) selected.set(name, entry.path as string)
      }
      if (!hasLicense && licensePaths.length === 0) {
        licensePaths = files.filter(file => /^(licen[sc]e|copying|unlicense)(?:$|[._-])/i.test(file!.name as string))
          .map(file => file!.path as string)
      }
    }
    for (const [name, title] of prose) {
      if (name === "security") {
        if (hasLicense) add(license!.path as string, label)
        else for (const path of licensePaths) add(path, "License")
      }
      const path = selected.get(name)
      if (path) add(path, title)
    }
    return documents
  }

  return {
    async documents(repo: Repo, branch: string, options?: RequestOptions): Promise<RepositoryDocument[]> {
      repositoryPath(repo)
      if (repo.visibility.toUpperCase() === "PUBLIC" && transport.page) {
        try {
          const html = await transport.page(`${repo.url.replace(/\/+$/, "")}/tree/${encodeURIComponent(branch)}`, options)
          const documents = overviewDocuments(html, repo, branch)
          if (documents !== undefined) return documents
        } catch (error) {
          if (options?.signal?.aborted || options?.budget?.signal.aborted || error instanceof RequestBudgetLimitError) throw error
          // Fall back to the ID-routed API when anonymous pages are unavailable.
        }
      }
      return fallback(repo, branch, options)
    },
    document: loadDocument,
  }

  function loadDocument(document: RepositoryDocument, options?: RequestOptions): Promise<string>
  function loadDocument(repository: RepositoryReference, document: RepositoryDocument, options?: RequestOptions): Promise<string>
  async function loadDocument(
    repositoryOrDocument: RepositoryReference | RepositoryDocument,
    documentOrOptions?: RepositoryDocument | RequestOptions,
    requestOptions?: RequestOptions,
  ): Promise<string> {
    const legacy = typeof repositoryOrDocument === "object" && "path" in repositoryOrDocument
    const document = (legacy ? repositoryOrDocument : documentOrOptions) as RepositoryDocument
    const options = (legacy ? documentOrOptions : requestOptions) as RequestOptions | undefined
    const repository = legacy ? document.repository : repositoryOrDocument as RepositoryReference
    const target = document.repository.toLowerCase() === repositoryName(repository).toLowerCase() ? repository : document.repository
    const base = repositoryPath(target)
    if (!filePath(document.path) || !nonempty(document.ref)) throw new Error("Invalid document source")
    const path = document.path.split("/").map(encodeURIComponent).join("/")
    return transport.text(`${base}/contents/${path}?ref=${encodeURIComponent(document.ref)}`, "application/vnd.github.raw+json", {
      ...options,
      maxBytes: Math.min(options?.maxBytes ?? 1024 * 1024, 1024 * 1024),
      limitMessage: "Document exceeds the 1 MiB viewing limit. Open it on GitHub.",
    })
  }
}
