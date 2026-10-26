import type Artplayer from "artplayer"

type DragOrigin = "progress" | "video" | null
type Pointer = { clientX: number; clientY: number }

const PLUGIN_NAME = "artplayerPluginDplayerProgress"
const DRAGGING_CLASS = "art-dplayer-progress-dragging"
const STYLE_ID = "artplayer-plugin-dplayer-progress-style"
const MOVE_THRESHOLD = 10
const PROGRESS_TOP_TOLERANCE = 18
const PROGRESS_BOTTOM_TOLERANCE = 4

function getPointer(event: Event): Pointer | null {
  if ("touches" in event) {
    const touchEvent = event as TouchEvent
    const touch = touchEvent.touches[0] || touchEvent.changedTouches[0]
    return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null
  }

  const mouseEvent = event as MouseEvent
  return Number.isFinite(mouseEvent.clientX) &&
    Number.isFinite(mouseEvent.clientY)
    ? { clientX: mouseEvent.clientX, clientY: mouseEvent.clientY }
    : null
}

function isTouchEvent(event: Event): event is TouchEvent {
  return "touches" in event
}

function includesElement(element: HTMLElement, event: Event): boolean {
  const path = event.composedPath?.() || []
  if (path.includes(element)) return true

  const target = event.target
  return (
    typeof Node !== "undefined" &&
    target instanceof Node &&
    element.contains(target)
  )
}

function isInside(element: HTMLElement, pointer: Pointer): boolean {
  const rect = element.getBoundingClientRect()
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    pointer.clientX >= rect.left &&
    pointer.clientX <= rect.right &&
    pointer.clientY >= rect.top &&
    pointer.clientY <= rect.bottom
  )
}

export default function artplayerPluginDplayerProgress(art: Artplayer) {
  const { addClass, clamp, removeClass, secondToTime, setStyle, setStyleText } =
    (art.constructor as typeof Artplayer).utils
  const { $bottom, $controls, $player, $progress, $setting, $video } =
    art.template
  const ownerDocument = $player.ownerDocument || document
  const ownerWindow = ownerDocument.defaultView || window
  const $played = $progress.querySelector<HTMLElement>(".art-progress-played")
  const $indicator = $progress.querySelector<HTMLElement>(
    ".art-progress-indicator",
  )
  const $time = art.controls.time

  if (!$played || !$indicator) return { name: PLUGIN_NAME }

  let dragging = false
  let wasPlaying = false
  let suppressClick = false
  let dragOrigin: DragOrigin = null
  let gestureStart: (Pointer & { currentTime: number }) | null = null
  let previewPercentage = 0
  let previewTime = 0
  let clickTimer: number | undefined
  const originalTouchAction = $progress.style.touchAction

  setStyleText(
    STYLE_ID,
    `
      .art-video-player.${DRAGGING_CLASS} .art-loading {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      .art-video-player.art-mobile .art-control-fullscreenWeb {
        display: none !important;
      }
    `,
  )

  const ownTimeDescriptor = Object.getOwnPropertyDescriptor(
    $video,
    "currentTime",
  )
  let videoPrototype: object | null = $video
  let timeDescriptor = ownTimeDescriptor
  while (!timeDescriptor && videoPrototype) {
    videoPrototype = Object.getPrototypeOf(videoPrototype)
    if (videoPrototype) {
      timeDescriptor = Object.getOwnPropertyDescriptor(
        videoPrototype,
        "currentTime",
      )
    }
  }

  const canLockCurrentTime =
    !ownTimeDescriptor &&
    typeof timeDescriptor?.get === "function" &&
    typeof timeDescriptor?.set === "function"

  if (canLockCurrentTime && timeDescriptor) {
    const descriptor = timeDescriptor
    // 115 CDN seeks may restart at byte zero if native seeking runs before drag release.
    Object.defineProperty($video, "currentTime", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get?.call($video) || 0
      },
      set(time: number) {
        if (!dragging) descriptor.set?.call($video, time)
      },
    })
  }

  $progress.style.touchAction = "none"

  const renderPreview = () => {
    const percentage = `${previewPercentage * 100}%`
    setStyle($played, "width", percentage)
    setStyle($indicator, "left", percentage)
    if ($time) {
      $time.textContent = `${secondToTime(previewTime)} / ${secondToTime(art.duration)}`
    }
  }

  const updatePreview = (percentage: number, time: number, event?: Event) => {
    previewPercentage = percentage
    previewTime = time
    art.emit("setBar", "played", percentage, event)
    if (
      event &&
      "clientX" in event &&
      !(art.constructor as typeof Artplayer).utils.isMobile
    ) {
      art.emit("setBar", "hover", percentage, event)
    }
    renderPreview()
  }

  const previewFromProgress = (event: Event): boolean => {
    const pointer = getPointer(event)
    const duration = Number.isFinite(art.duration) ? art.duration : 0
    if (!pointer || duration <= 0) return false

    let percentage: number
    if (art.isRotate && isTouchEvent(event)) {
      if (art.height <= 0) return false
      percentage = clamp(pointer.clientY / art.height, 0, 1)
    } else {
      const rect = $progress.getBoundingClientRect()
      if (rect.width <= 0) return false
      percentage = clamp((pointer.clientX - rect.left) / rect.width, 0, 1)
    }

    updatePreview(percentage, percentage * duration, event)
    return true
  }

  const previewFromGesture = (event: Event): boolean => {
    const pointer = getPointer(event)
    const duration = Number.isFinite(art.duration) ? art.duration : 0
    const start = gestureStart
    if (!pointer || !start || duration <= 0) return false

    const dimension = art.isRotate ? art.height : art.width
    if (dimension <= 0) return false

    const movement = art.isRotate
      ? pointer.clientY - start.clientY
      : pointer.clientX - start.clientX
    const ratio =
      clamp(movement / dimension, -1, 1) *
      (art.constructor as typeof Artplayer).TOUCH_MOVE_RATIO
    const time = clamp(start.currentTime + duration * ratio, 0, duration)
    updatePreview(duration ? time / duration : 0, time, event)
    art.notice.show = `${secondToTime(time)} / ${secondToTime(duration)}`
    return true
  }

  const updateDrag = (event: Event) => {
    if (dragOrigin === "video") previewFromGesture(event)
    else previewFromProgress(event)
  }

  const setDragging = (state: boolean) => {
    if (state) {
      addClass($player, DRAGGING_CLASS)
      art.loading.show = false
    } else {
      removeClass($player, DRAGGING_CLASS)
    }
  }

  const resumePlayback = () => {
    if (!wasPlaying) return
    wasPlaying = false
    void art.play().catch(() => undefined)
  }

  const clearClickTimer = () => {
    if (clickTimer !== undefined) {
      ownerWindow.clearTimeout(clickTimer)
      clickTimer = undefined
    }
  }

  const armClickSuppression = () => {
    suppressClick = true
    clearClickTimer()
    clickTimer = ownerWindow.setTimeout(() => {
      suppressClick = false
      clickTimer = undefined
    }, 0)
  }

  const beginDrag = (origin: Exclude<DragOrigin, null>, event: Event) => {
    dragOrigin = origin
    if (isTouchEvent(event)) {
      wasPlaying = art.playing
      if (wasPlaying) art.pause()
    }
    dragging = true
    setDragging(true)
  }

  const beginProgressDrag = (event: Event): boolean => {
    if (!previewFromProgress(event)) return false
    beginDrag("progress", event)
    return true
  }

  const finishDrag = (event: Event | undefined, commit: boolean) => {
    if (!dragging) return
    if (event) updateDrag(event)

    const finalTime = previewTime
    dragging = false
    dragOrigin = null
    gestureStart = null
    setDragging(false)

    if (commit) {
      art.seek = finalTime
    } else {
      previewTime = art.currentTime
      previewPercentage = art.duration
        ? clamp(previewTime / art.duration, 0, 1)
        : 0
      art.emit("setBar", "played", previewPercentage)
      renderPreview()
    }
    resumePlayback()
  }

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !beginProgressDrag(event)) return
    armClickSuppression()
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onClick = (event: MouseEvent) => {
    if (!suppressClick) return
    suppressClick = false
    clearClickTimer()
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onMouseMove = (event: MouseEvent) => {
    if (!dragging) return
    updateDrag(event)
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onMouseUp = (event: MouseEvent) => {
    if (!dragging) return
    finishDrag(event, true)
    event.preventDefault()
    event.stopImmediatePropagation()
    armClickSuppression()
  }

  const isProgressTouch = (event: TouchEvent, pointer: Pointer) => {
    const path = event.composedPath?.() || []
    if (includesElement($setting, event)) return false
    if (path.includes($progress)) return true
    if (
      !(art.constructor as typeof Artplayer).utils.isMobile ||
      includesElement($controls, event)
    ) {
      return false
    }

    const rect = $progress.getBoundingClientRect()
    return (
      rect.width > 0 &&
      pointer.clientX >= rect.left &&
      pointer.clientX <= rect.right &&
      pointer.clientY >= rect.top - PROGRESS_TOP_TOLERANCE &&
      pointer.clientY <= rect.bottom + PROGRESS_BOTTOM_TOLERANCE
    )
  }

  const isVideoGestureTouch = (event: TouchEvent, pointer: Pointer) => {
    const path = event.composedPath?.() || []
    if (
      !(art.constructor as typeof Artplayer).utils.isMobile ||
      includesElement($setting, event) ||
      includesElement($bottom, event) ||
      includesElement($controls, event) ||
      path.includes($progress)
    ) {
      return false
    }
    return isInside($player, pointer)
  }

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1 || art.isLock) return
    const pointer = getPointer(event)
    if (!pointer) return

    if (isProgressTouch(event, pointer) && beginProgressDrag(event)) {
      armClickSuppression()
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    if (isVideoGestureTouch(event, pointer)) {
      gestureStart = {
        ...pointer,
        currentTime: art.currentTime,
      }
      event.stopImmediatePropagation()
    }
  }

  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) return
    if (dragging) {
      updateDrag(event)
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    const start = gestureStart
    const pointer = getPointer(event)
    if (!start || !pointer) return

    const deltaX = pointer.clientX - start.clientX
    const deltaY = pointer.clientY - start.clientY
    if (
      Math.abs(deltaX) < MOVE_THRESHOLD &&
      Math.abs(deltaY) < MOVE_THRESHOLD
    ) {
      return
    }

    const horizontal = Math.abs(deltaX) > Math.abs(deltaY)
    if ((!art.isRotate && !horizontal) || (art.isRotate && horizontal)) {
      gestureStart = null
      return
    }

    dragOrigin = "video"
    wasPlaying = art.playing
    if (wasPlaying) art.pause()
    if (!previewFromGesture(event)) {
      dragOrigin = null
      gestureStart = null
      return
    }
    dragging = true
    setDragging(true)
    armClickSuppression()
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onTouchEnd = (event: TouchEvent) => {
    gestureStart = null
    if (!dragging) return
    finishDrag(event, true)
    event.preventDefault()
    event.stopImmediatePropagation()
    armClickSuppression()
  }

  const onTouchCancel = (event: TouchEvent) => {
    gestureStart = null
    if (!dragging) return
    finishDrag(undefined, false)
    event.stopImmediatePropagation()
  }

  const onSetBar = (type: string) => {
    if (dragging && type === "played") renderPreview()
  }
  const onLoading = () => {
    if (dragging) art.loading.show = false
  }

  $progress.addEventListener("mousedown", onMouseDown, true)
  $progress.addEventListener("click", onClick, true)
  ownerDocument.addEventListener("touchstart", onTouchStart, {
    capture: true,
    passive: false,
  })
  ownerDocument.addEventListener("touchmove", onTouchMove, {
    capture: true,
    passive: false,
  })
  ownerDocument.addEventListener("touchend", onTouchEnd, {
    capture: true,
    passive: false,
  })
  ownerDocument.addEventListener("touchcancel", onTouchCancel, {
    capture: true,
    passive: false,
  })
  ownerDocument.addEventListener("mousemove", onMouseMove)
  ownerDocument.addEventListener("mouseup", onMouseUp)
  art.events.bindGlobalEvents({ document: ownerDocument, window: ownerWindow })
  art.on("setBar", onSetBar)
  art.on("video:timeupdate", renderPreview)
  art.on("video:loadstart", onLoading)
  art.on("video:seeking", onLoading)
  art.on("video:waiting", onLoading)
  art.once("destroy", () => {
    clearClickTimer()
    setDragging(false)
    $progress.style.touchAction = originalTouchAction
    if (canLockCurrentTime) Reflect.deleteProperty($video, "currentTime")
    $progress.removeEventListener("mousedown", onMouseDown, true)
    $progress.removeEventListener("click", onClick, true)
    ownerDocument.removeEventListener("touchstart", onTouchStart, true)
    ownerDocument.removeEventListener("touchmove", onTouchMove, true)
    ownerDocument.removeEventListener("touchend", onTouchEnd, true)
    ownerDocument.removeEventListener("touchcancel", onTouchCancel, true)
    ownerDocument.removeEventListener("mousemove", onMouseMove)
    ownerDocument.removeEventListener("mouseup", onMouseUp)
    art.off("setBar", onSetBar)
    art.off("video:timeupdate", renderPreview)
    art.off("video:loadstart", onLoading)
    art.off("video:seeking", onLoading)
    art.off("video:waiting", onLoading)
  })

  return { name: PLUGIN_NAME }
}
