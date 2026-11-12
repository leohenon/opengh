import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const installer = fileURLToPath(new URL("../install.sh", import.meta.url))
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function fixture(body: string, musl = false) {
  const directory = await mkdtemp(join(tmpdir(), "opengh-installer-"))
  directories.push(directory)
  const destination = join(directory, "install with spaces"), tools = join(directory, "tools"), release = join(directory, "release"), temporary = join(directory, "tmp")
  const target = musl ? "linux-arm64-musl" : "darwin-arm64"
  const payload = join(directory, `opengh-${target}`)
  await Promise.all([destination, tools, release, temporary, payload].map(path => mkdir(path)))
  const script = async (path: string, body: string) => {
    await writeFile(path, `#!/bin/sh\n${body}\n`)
    await chmod(path, 0o755)
  }
  await script(join(tools, "uname"), `case "$1" in -s) echo ${musl ? "Linux" : "Darwin"};; -m) echo arm64;; *) exit 1;; esac`)
  if (musl) await script(join(tools, "ldd"), "echo musl")
  // Never contact GitHub. The installer downloads a real checksum-verified archive from this fixture.
  await script(join(tools, "curl"), `test "$1" = -fsSL && test "$3" = -o || exit 2
case "$2" in "file://$FIXTURE_RELEASE/"*) cp "\${2#file://}" "$4";; *) exit 2;; esac`)
  await script(join(payload, "opengh"), body)
  const archive = `opengh-${target}.tar.gz`
  const tar = Bun.spawn(["tar", "-czf", join(release, archive), `opengh-${target}`], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [code, error] = await Promise.all([tar.exited, new Response(tar.stderr).text()])
  expect(code, error).toBe(0)
  const checksum = createHash("sha256").update(await readFile(join(release, archive))).digest("hex")
  await writeFile(join(release, "SHA256SUMS"), `${checksum}  ${archive}\n`)
  const env = { ...process.env, PATH: `${tools}:${process.env.PATH}`, HOME: directory, TMPDIR: temporary,
    FIXTURE_RELEASE: release, OPENGH_INSTALL_DIR: destination, OPENGH_DOWNLOAD_BASE_URL: `file://${release}` }
  return { destination, temporary, script, run: async () => {
    const child = Bun.spawn(["sh", installer], { cwd: directory, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, out, error }
  } }
}

for (const musl of [false, true]) {
  test(`a valid download that cannot start preserves the installed executable (musl: ${musl})`, async () => {
    const f = await fixture("exit 127", musl)
    const path = join(f.destination, "opengh")
    await f.script(path, 'echo "opengh old-working-version"')
    const previous = await readFile(path)
    const result = await f.run()
    expect(result.code).not.toBe(0)
    expect(result.error).toContain("does not start")
    if (musl) expect(result.error).toContain("apk add libstdc++ libgcc")
    expect(await readFile(path)).toEqual(previous)
    expect(await readdir(f.destination)).toEqual(["opengh"])
    expect(await readdir(f.temporary)).toEqual([])
  })
}

test("an incompatible first install leaves no executable or staging files", async () => {
  const f = await fixture("exit 127")
  expect((await f.run()).code).not.toBe(0)
  expect(await readdir(f.destination)).toEqual([])
  expect(await readdir(f.temporary)).toEqual([])
})

test.each([false, true])("a working download installs and reinstalls cleanly (existing install: %s)", async existing => {
  const f = await fixture('test "$1" = --version || exit 1\necho "opengh 0.0.0"')
  if (existing) await f.script(join(f.destination, "opengh"), 'echo "opengh old-working-version"')
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.run()
    expect(result, result.error).toMatchObject({ code: 0 })
    expect(result.out).toContain(`Installed opengh 0.0.0 to ${f.destination}/opengh`)
    expect(await readFile(join(f.destination, "opengh"), "utf8")).toContain('echo "opengh 0.0.0"')
    expect(await readdir(f.destination)).toEqual(["opengh"])
    expect(await readdir(f.temporary)).toEqual([])
  }
})

test("a destination directory named opengh is not treated as an installed executable", async () => {
  const f = await fixture('echo "opengh 0.0.0"')
  await mkdir(join(f.destination, "opengh"))
  expect((await f.run()).code).not.toBe(0)
  expect(await readdir(join(f.destination, "opengh"))).toEqual([])
  expect(await readdir(f.destination)).toEqual(["opengh"])
})
