import { afterEach, expect, test } from "bun:test"
import { BoxRenderable, InputRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { SearchablePicker } from "../src/ui/components/searchable-picker"
import { ThemePicker } from "../src/ui/components/theme-picker"
import type { ThemeName } from "../src/theme"

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> = []
afterEach(() => {
  for (const view of active.splice(0)) if (!view.renderer.isDestroyed) view.renderer.destroy()
})

test("picker hover highlights without changing keyboard selection, query, or focus", async () => {
  let selected = ""
  const view = await testRender(() => (
    <SearchablePicker title="Choose" placeholder="Search" height={12}
      items={["alpha", "beta"]} itemKey={(item) => item}
      match={(item, query) => item.includes(query) ? 0 : undefined}
      onSelect={(item) => { selected = item }} onClose={() => {}}>
      {(item) => <text>{item}</text>}
    </SearchablePicker>
  ), { width: 80, height: 24 })
  active.push(view)
  await view.flush()
  await view.mockInput.typeText("a")
  await view.flush()
  const first = view.renderer.root.findDescendantById("picker-row-0") as BoxRenderable
  const second = view.renderer.root.findDescendantById("picker-row-1") as BoxRenderable
  const query = view.renderer.root.findDescendantById("picker-query") as InputRenderable
  const idle = second.backgroundColor
  expect(idle).not.toEqual(first.backgroundColor)

  await view.mockMouse.moveTo(second.x + 4, second.y)
  await view.flush()
  expect(second.backgroundColor).toEqual(first.backgroundColor)
  expect(view.captureCharFrame().split("\n").find((line) => line.includes("beta"))).not.toContain("›")
  expect(query.value).toBe("a")
  expect(query.focused).toBe(true)
  expect(selected).toBe("")

  view.mockInput.pressEnter()
  await view.flush()
  expect(selected).toBe("alpha")
  expect(second.backgroundColor).toEqual(idle)
  expect(query.value).toBe("a")
  expect(query.focused).toBe(true)
})

test("theme hover never previews or saves and busy rows lose their hover", async () => {
  const [saving, setSaving] = createSignal(false)
  const previews: ThemeName[] = []
  const saves: ThemeName[] = []
  const view = await testRender(() => (
    <ThemePicker current="github" saving={saving()}
      onPreview={(name) => { previews.push(name) }} onCancel={() => {}}
      onSelect={async (name) => { saves.push(name) }} />
  ), { width: 80, height: 45 })
  active.push(view)
  await view.flush()
  const current = view.renderer.root.findDescendantById("theme-github") as BoxRenderable
  const other = view.renderer.root.findDescendantById("theme-dracula") as BoxRenderable
  const idle = other.backgroundColor
  const initialPreviews = [...previews]
  await view.mockMouse.moveTo(other.x + 4, other.y)
  await view.flush()
  expect(other.backgroundColor).toEqual(current.backgroundColor)
  expect(previews).toEqual(initialPreviews)
  expect(saves).toEqual([])
  expect(view.captureCharFrame().split("\n").find((line) => line.includes("dracula"))).not.toContain("›")

  setSaving(true)
  await view.flush()
  expect(other.backgroundColor).toEqual(idle)
  await view.mockMouse.moveTo(other.x + 5, other.y)
  await view.flush()
  expect(other.backgroundColor).toEqual(idle)
  expect(previews).toEqual(initialPreviews)
  expect(saves).toEqual([])
})
