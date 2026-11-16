import { createSignal } from "solid-js"
import { abandonGitHubWrites } from "./process"

// Quitting waits for writes: stopping one midway leaves it unknown whether GitHub applied it.
export type GitHubWrites = {
  active(): number
  track<T>(write: Promise<T>): Promise<T>
  // Includes writes started while waiting.
  settled(): Promise<void>
  // Lets shutdown stop writes in flight.
  abandon(): void
}

export function createGitHubWrites(abandon: () => void = () => {}): GitHubWrites {
  const [active, setActive] = createSignal(0)
  let idle = Promise.withResolvers<void>()
  idle.resolve()
  return {
    active,
    track(write) {
      if (active() === 0) idle = Promise.withResolvers<void>()
      setActive((count) => count + 1)
      const done = () => {
        setActive((count) => count - 1)
        if (active() === 0) idle.resolve()
      }
      write.then(done, done)
      return write
    },
    async settled() {
      while (active() > 0) await idle.promise
    },
    abandon,
  }
}

export const githubWrites = createGitHubWrites(abandonGitHubWrites)
