import assert from "node:assert/strict"
import test from "node:test"
import plugin from "./index.ts"

class Target {
  constructor(parent = null, rect = { left: 0, top: 0, width: 100, height: 10 }) {
    this.parentNode = parent; this.nodeType = 1; this.rect = rect
    this.listeners = new Map(); this.children = new Map(); this.style = { touchAction: "pan-x" }; this.classes = new Set(); this.textContent = ""
  }
  contains(node) { for (; node; node = node.parentNode) if (node === this) return true; return false }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]) }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== fn)) }
  dispatch(type, e) { e.target ??= this; for (const fn of this.listeners.get(type) || []) { fn(e); if (e.stopped) break } }
  querySelector(name) { return this.children.get(name) || null }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height } }
}
globalThis.Node = Target

function event(props = {}) {
  return { stopped: false, composedPath: () => props.path || [], preventDefault() { this.prevented = true }, stopImmediatePropagation() { this.stopped = true }, ...props }
}
function touch(x, path, ended = false) {
  const point = { clientX: x, clientY: 85 }
  return event({ touches: ended ? [] : [point], changedTouches: [point], path })
}
function setup(mobile) {
  const win = { setTimeout, clearTimeout }, doc = new Target(); doc.defaultView = win
  const player = new Target(doc, { left: 0, top: 0, width: 100, height: 100 }); player.ownerDocument = doc
  const progress = new Target(player, { left: 0, top: 80, width: 100, height: 10 })
  const played = new Target(progress), indicator = new Target(progress)
  progress.children.set(".art-progress-played", played); progress.children.set(".art-progress-indicator", indicator)
  const video = new (class extends Target { constructor() { super(player); this.time = 20 } get currentTime() { return this.time } set currentTime(v) { this.time = v } })()
  const callbacks = new Map(), seeks = []
  const utils = { isMobile: mobile, addClass: (e, n) => e.classes.add(n), removeClass: (e, n) => e.classes.delete(n), clamp: (v, a, b) => Math.max(a, Math.min(b, v)), secondToTime: String, setStyle: (e, k, v) => { e.style[k] = v }, setStyleText() {} }
  const art = {
    constructor: { utils, TOUCH_MOVE_RATIO: 0.5 },
    template: { $bottom: new Target(player), $controls: new Target(player), $player: player, $progress: progress, $setting: new Target(player), $video: video },
    controls: { time: new Target() }, events: { bindGlobalEvents() {} }, loading: { show: true }, notice: { show: "" },
    duration: 100, width: 100, height: 100, isRotate: false, isLock: false, playing: true,
    get currentTime() { return video.currentTime }, set seek(v) { seeks.push(v); video.currentTime = v },
    pause() { this.playing = false }, play() { this.playing = true; return Promise.resolve() },
    on(n, f) { callbacks.set(n, [...(callbacks.get(n) || []), f]); return this },
    once(n, f) { return this.on(n, f) }, off(n, f) { callbacks.set(n, (callbacks.get(n) || []).filter(x => x !== f)); return this },
    emit(n, ...a) { for (const f of callbacks.get(n) || []) f(...a); return this },
  }
  return { art, doc, progress, played, video, seeks }
}

test("PC drag previews while held, then seeks once on release", () => {
  const s = setup(false); plugin(s.art)
  s.progress.dispatch("mousedown", event({ button: 0, clientX: 20, clientY: 85 }))
  s.video.currentTime = 0
  s.doc.dispatch("mousemove", event({ clientX: 75, clientY: 85 }))
  assert.equal(s.video.currentTime, 20); assert.equal(s.played.style.width, "75%"); assert.deepEqual(s.seeks, [])
  s.doc.dispatch("mouseup", event({ clientX: 80, clientY: 85 }))
  assert.deepEqual(s.seeks, [80]); assert.equal(s.video.currentTime, 80)
})
test("phone touch drag seeks once at touchend", () => {
  const s = setup(true); plugin(s.art); const path = [s.progress, s.art.template.$player, s.doc]
  s.doc.dispatch("touchstart", touch(20, path)); s.doc.dispatch("touchmove", touch(60, path))
  assert.equal(s.video.currentTime, 20); assert.equal(s.played.style.width, "60%"); assert.deepEqual(s.seeks, [])
  s.doc.dispatch("touchend", touch(70, path, true))
  assert.deepEqual(s.seeks, [70]); assert.equal(s.video.currentTime, 70); assert.equal(s.art.playing, true)
})
test("cancelled phone drag never seeks", () => {
  const s = setup(true); plugin(s.art); const path = [s.progress, s.art.template.$player, s.doc]
  s.doc.dispatch("touchstart", touch(20, path)); s.doc.dispatch("touchmove", touch(60, path)); s.doc.dispatch("touchcancel", touch(60, path, true))
  assert.deepEqual(s.seeks, []); assert.equal(s.video.currentTime, 20); assert.equal(s.played.style.width, "20%"); assert.equal(s.art.playing, true)
})
