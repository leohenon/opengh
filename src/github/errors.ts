function authenticationGuidance(message: string, status?: number) {
  if (/timeout|timed out|deadline exceeded/i.test(message))
    return "GitHub request timed out."
  if (/no such host|could not resolve host|connection refused|connection reset|network is unreachable|network is down|unexpected EOF|TLS handshake|x509:/i.test(message))
    return "Could not connect to GitHub."
  if (status === 401 || /gh auth login|not logged (?:in|into)/i.test(message)) {
    const token = process.env.GH_TOKEN ? "GH_TOKEN" : process.env.GITHUB_TOKEN ? "GITHUB_TOKEN" : undefined
    return `${message}. ${token
      ? `Update or unset ${token}; it overrides saved credentials.`
      : "Run gh auth login --hostname github.com and retry."}`
  }
  if (status === 429 || /rate limit/i.test(message))
    return `${message}. GitHub is rate limiting requests; wait before retrying.`
  if (status === 403 || /resource not accessible|insufficient scopes/i.test(message))
    return `${message}. Check account access, token permissions, and organization SSO authorization.`
  return message
}

export class GitHubApiError extends Error {
  readonly path: string
  readonly status?: number

  constructor(path: string, message: string, status = httpStatus(message)) {
    super(authenticationGuidance(message, status))
    this.name = "GitHubApiError"
    this.path = path
    this.status = status
  }
}

function httpStatus(message: string) {
  const match = message.match(/HTTP\s+(\d{3})/i)
  return match ? Number(match[1]) : undefined
}
