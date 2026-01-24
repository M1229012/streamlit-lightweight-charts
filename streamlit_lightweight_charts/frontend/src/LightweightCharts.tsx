import { useRenderData } from "streamlit-component-lib-react-hooks"
import { createChart, IChartApi, MouseEventParams, ISeriesApi } from "lightweight-charts"
import React, { useRef, useEffect, useMemo } from "react"

// ====================================================================
// 1. 輔助函式：統一日期處理
// ====================================================================

function normalizeDate(d: any): number | null {
  if (d == null) return null
  if (typeof d === "number") return d
  if (typeof d === "string") {
    const dateObj = new Date(d)
    if (!isNaN(dateObj.getTime())) {
      return dateObj.getTime() / 1000
    }
    return null
  }
  if (typeof d === "object" && "year" in d && "month" in d && "day" in d) {
    const dateObj = new Date(d.year, d.month - 1, d.day)
    return dateObj.getTime() / 1000
  }
  return null
}

function formatTime(t: any) {
  if (t == null) return ""
  if (typeof t === "number") {
    const d = new Date(t * 1000)
    return d.toISOString().split("T")[0]
  }
  if (typeof t === "object" && "year" in t) {
    const y = t.year
    const m = String(t.month).padStart(2, "0")
    const d = String(t.day).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  return String(t)
}

function toFixedMaybe(v: any, digits = 2) {
  if (v == null || Number.isNaN(v)) return "--"
  if (typeof v !== "number") return String(v)
  return v.toFixed(digits)
}

// ====================================================================
// 2. DOM 元素建立
// ====================================================================

function ensurePaneTooltip(container: HTMLDivElement) {
  let toolTip = container.querySelector(".floating-tooltip") as HTMLDivElement | null
  if (!toolTip) {
    toolTip = document.createElement("div")
    toolTip.className = "floating-tooltip"
    Object.assign(toolTip.style, {
      position: "absolute",
      display: "none",
      padding: "8px 10px",
      fontSize: "12px",
      zIndex: "1000",
      top: "10px",
      left: "10px",
      pointerEvents: "none",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "4px",
      background: "rgba(20, 20, 20, 0.9)",
      color: "#ececec",
      boxShadow: "0 2px 5px rgba(0,0,0,0.5)",
      fontFamily: "monospace",
    })
    const style = getComputedStyle(container)
    if (style.position === "static") container.style.position = "relative"
    container.appendChild(toolTip)
  }
  return toolTip
}

function ensureGlobalVLine(host: HTMLDivElement) {
  let line = host.querySelector(".global-vline") as HTMLDivElement | null
  if (!line) {
    line = document.createElement("div")
    line.className = "global-vline"
    Object.assign(line.style, {
      position: "absolute",
      top: "0px",
      bottom: "0px",
      width: "1px",
      background: "rgba(255,255,255,0.3)",
      display: "none",
      pointerEvents: "none",
      zIndex: "900",
      transform: "translateX(-0.5px)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(line)
  }
  return line
}

function ensureGlobalMask(host: HTMLDivElement) {
  let mask = host.querySelector(".global-mask") as HTMLDivElement | null
  if (!mask) {
    mask = document.createElement("div")
    mask.className = "global-mask"
    Object.assign(mask.style, {
      position: "absolute",
      top: "0px",
      bottom: "0px",
      left: "0px",
      width: "0px",
      display: "none",
      pointerEvents: "none",
      zIndex: "800",
      background: "rgba(255, 235, 59, 0.15)",
      borderLeft: "1px solid rgba(255, 235, 59, 0.4)",
      borderRight: "1px solid rgba(255, 235, 59, 0.4)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(mask)
  }
  return mask
}

// ====================================================================
// 2.1 畫線工具 DOM
// ====================================================================

type DrawMode = "mouse" | "line" | "ray" | "hline" | "rect" | "fib" | "brush"

const ICONS = {
  drag: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 19a2 2 0 100-4 2 2 0 000 4zM7 13a2 2 0 100-4 2 2 0 000 4zM7 7a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4zM17 13a2 2 0 100-4 2 2 0 000 4zM17 7a2 2 0 100-4 2 2 0 000 4z"></path></svg>`,
  mouse: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>`,
  line: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="20" y2="4"></line><circle cx="4" cy="20" r="2" fill="currentColor"></circle><circle cx="20" cy="4" r="2" fill="currentColor"></circle></svg>`,
  ray: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="20" y2="4"></line><path d="M16 4h4v4"></path><circle cx="4" cy="20" r="2" fill="currentColor"></circle></svg>`,
  hline: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="12" x2="22" y2="12"></line><circle cx="12" cy="12" r="2" fill="currentColor"></circle></svg>`,
  rect: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16"></rect><circle cx="4" cy="4" r="2" fill="currentColor"></circle><circle cx="20" cy="20" r="2" fill="currentColor"></circle></svg>`,
  fib: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="4" x2="20" y2="4"></line><line x1="4" y1="12" x2="20" y2="12" stroke-dasharray="2,2"></line><line x1="4" y1="20" x2="20" y2="20"></line><line x1="12" y1="4" x2="12" y2="20" stroke-width="1" opacity="0.5"></line></svg>`,
  brush: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 12c2 0 3-1 3-3s-1-3-3-3-4 1-6 3l-7 7c-1 1-1 3 0 4s3 1 4 0l7-7"></path></svg>`,
}

function setToolbarActive(toolbar: HTMLDivElement, mode: DrawMode) {
  const btns = toolbar.querySelectorAll("button[data-mode]") as NodeListOf<HTMLButtonElement>
  btns.forEach((b) => {
    const m = (b.getAttribute("data-mode") || "mouse") as DrawMode
    const isActive = m === mode
    Object.assign(b.style, {
      background: isActive ? "#e6f7ff" : "transparent",
      color: isActive ? "#1890ff" : "#555",
      border: isActive ? "1px solid #1890ff" : "1px solid transparent",
    })
  })
}

function ensureDrawToolbar(
  host: HTMLDivElement,
  getMode: () => DrawMode,
  setMode: (m: DrawMode) => void,
  getColor: () => string,
  setColor: (c: string) => void,
  getWidth: () => number,
  setWidth: (w: number) => void,
  getVP: () => boolean,
  setVP: (v: boolean) => void
) {
  let toolbar = host.querySelector(".draw-toolbar") as HTMLDivElement | null
  
  if (!toolbar) {
    toolbar = document.createElement("div")
    toolbar.className = "draw-toolbar"
    
    Object.assign(toolbar.style, {
      position: "absolute",
      top: "20px", 
      left: "100px", 
      zIndex: "1100",
      display: "flex",
      gap: "4px",
      padding: "4px 8px",
      borderRadius: "20px",
      background: "#ffffff",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      border: "1px solid #e0e0e0",
      pointerEvents: "auto",
      userSelect: "none",
      alignItems: "center",
      color: "#333",
    })

    const dragHandle = document.createElement("div")
    dragHandle.innerHTML = ICONS.drag
    Object.assign(dragHandle.style, {
      cursor: "grab",
      padding: "4px",
      display: "flex",
      alignItems: "center",
      color: "#999",
      marginRight: "4px",
    })
    
    let isDragging = false
    let startX = 0, startY = 0
    let startLeft = 0, startTop = 0

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !toolbar) return
      e.preventDefault()
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      toolbar.style.left = `${startLeft + dx}px`
      toolbar.style.top = `${startTop + dy}px`
    }

    const onMouseUp = () => {
      isDragging = false
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      if(dragHandle) dragHandle.style.cursor = "grab"
    }

    dragHandle.addEventListener("mousedown", (e) => {
      isDragging = true
      startX = e.clientX
      startY = e.clientY
      startLeft = toolbar!.offsetLeft
      startTop = toolbar!.offsetTop
      dragHandle.style.cursor = "grabbing"
      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    })

    toolbar.appendChild(dragHandle)

    const mkBtn = (iconHtml: string, mode: DrawMode, title: string) => {
      const b = document.createElement("button")
      b.type = "button"
      b.innerHTML = iconHtml
      b.title = title
      b.setAttribute("data-mode", mode)
      Object.assign(b.style, {
        width: "32px",
        height: "32px",
        padding: "4px",
        borderRadius: "6px",
        cursor: "pointer",
        background: "transparent",
        border: "1px solid transparent",
        color: "#555",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.2s",
      })
      b.addEventListener("click", () => {
        setMode(mode)
        setToolbarActive(toolbar!, getMode())
      })
      return b
    }

    toolbar.appendChild(mkBtn(ICONS.mouse, "mouse", "滑鼠"))
    toolbar.appendChild(mkBtn(ICONS.line, "line", "直線"))
    toolbar.appendChild(mkBtn(ICONS.ray, "ray", "延長線"))
    toolbar.appendChild(mkBtn(ICONS.hline, "hline", "水平線"))
    toolbar.appendChild(mkBtn(ICONS.fib, "fib", "斐波那契回撤"))
    toolbar.appendChild(mkBtn(ICONS.brush, "brush", "筆刷"))
    toolbar.appendChild(mkBtn(ICONS.rect, "rect", "方框"))

    const divider = () => {
      const d = document.createElement("div")
      Object.assign(d.style, {
        width: "1px",
        height: "20px",
        background: "#e0e0e0",
        margin: "0 6px",
      })
      return d
    }
    toolbar.appendChild(divider())

    const colorWrap = document.createElement("div")
    Object.assign(colorWrap.style, {
      display: "flex", alignItems: "center", justifyContent: "center",
      width: "24px", height: "24px", borderRadius: "50%",
      border: "1px solid #ddd", overflow: "hidden", cursor: "pointer",
      position: "relative"
    })
    const colorInput = document.createElement("input")
    colorInput.type = "color"
    colorInput.value = getColor()
    Object.assign(colorInput.style, {
      position: "absolute",
      top: "-50%", left: "-50%",
      width: "200%", height: "200%",
      padding: 0, border: "none", cursor: "pointer",
    })
    colorInput.addEventListener("input", () => {
      setColor(colorInput.value)
    })
    colorWrap.appendChild(colorInput)
    toolbar.appendChild(colorWrap)

    const widthSel = document.createElement("select")
    Object.assign(widthSel.style, {
      height: "24px",
      fontSize: "12px",
      borderRadius: "4px",
      background: "#f5f5f5",
      color: "#333",
      border: "1px solid #ddd",
      padding: "0 2px",
      cursor: "pointer",
      outline: "none",
      marginLeft: "6px"
    })
    ;[1, 2, 3, 4, 5].forEach((n) => {
      const opt = document.createElement("option")
      opt.value = String(n)
      opt.textContent = `${n}px`
      widthSel.appendChild(opt)
    })
    widthSel.value = String(getWidth())
    widthSel.addEventListener("change", () => {
      const v = parseInt(widthSel.value, 10)
      if (Number.isFinite(v)) setWidth(v)
    })
    toolbar.appendChild(widthSel)

    toolbar.appendChild(divider())

    const vpBtn = document.createElement("button")
    vpBtn.type = "button"
    vpBtn.className = "vp-toggle"
    vpBtn.title = "切換分價圖"
    vpBtn.textContent = "VP"
    Object.assign(vpBtn.style, {
      fontSize: "11px",
      fontWeight: "bold",
      padding: "2px 6px",
      height: "24px",
      borderRadius: "4px",
      cursor: "pointer",
      background: "#f5f5f5",
      border: "1px solid #ddd",
      color: "#555",
    })
    const syncVPBtn = () => {
      const on = getVP()
      Object.assign(vpBtn.style, {
        background: on ? "#1890ff" : "#f5f5f5",
        color: on ? "#fff" : "#555",
        border: on ? "1px solid #1890ff" : "1px solid #ddd"
      })
    }
    vpBtn.addEventListener("click", () => {
      setVP(!getVP())
      syncVPBtn()
    })
    syncVPBtn()
    toolbar.appendChild(vpBtn)

    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(toolbar)
  }

  setToolbarActive(toolbar, getMode())
  
  const ci = toolbar.querySelector('input[type="color"]') as HTMLInputElement | null
  if (ci) ci.value = getColor()
  
  const ws = toolbar.querySelector("select") as HTMLSelectElement | null
  if (ws) ws.value = String(getWidth())

  const vpBtn = toolbar.querySelector(".vp-toggle") as HTMLButtonElement | null
  if (vpBtn) {
    const on = getVP()
    Object.assign(vpBtn.style, {
      background: on ? "#1890ff" : "#f5f5f5",
      color: on ? "#fff" : "#555",
      border: on ? "1px solid #1890ff" : "1px solid #ddd"
    })
  }

  return toolbar
}

function ensureDrawingLayer(container: HTMLDivElement) {
  let svg = container.querySelector(".drawing-layer") as SVGSVGElement | null
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement
    svg.classList.add("drawing-layer")
    Object.assign(svg.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "850",
    })
    const style = getComputedStyle(container)
    if (style.position === "static") container.style.position = "relative"
    container.appendChild(svg)
  }
  return svg
}

// ====================================================================
// 3. React Component
// ====================================================================

type SeriesMeta = {
  api: ISeriesApi<any>
  title: string
  options: any
}

type PaneMeta = {
  chart: IChartApi
  container: HTMLDivElement
  tooltip: HTMLDivElement
  series: SeriesMeta[]
}

type DrawingMode = "line" | "ray" | "hline" | "rect" | "fib" | "brush"

type Drawing = {
  mode: DrawingMode
  t1: any
  p1: number
  t2: any
  p2: number
  color: string
  width: number
  l1?: number
  l2?: number
  points?: { l: number; p: number }[]
}

type PendingPoint = {
  mode: DrawMode
  t: any
  p: number
  l: number
}

type DragPart = "body" | "p1" | "p2"

type DragState = {
  idx: number
  orig: Drawing
  startLogical: number
  startPrice: number
  origL1: number
  origL2: number
  part: DragPart
}

// ✅ 筆刷平滑化：使用中點貝茲曲線 (Midpoint Quadratic Bezier)
function getSvgPathFromPoints(points: {x:number, y:number}[]): string {
    if (points.length === 0) return ""
    if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`

    let d = `M ${points[0].x} ${points[0].y}`

    // 從第一點開始，遍歷到倒數第二點
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i]
        const p2 = points[i + 1]
        
        // 找出兩點的中點
        const midX = (p1.x + p2.x) / 2
        const midY = (p1.y + p2.y) / 2
        
        // 使用 quadratic bezier curve (Q)
        // 控制點是 p1，終點是 mid
        d += ` Q ${p1.x} ${p1.y} ${midX} ${midY}`
    }

    // 連接最後一點
    const last = points[points.length - 1]
    d += ` L ${last.x} ${last.y}`

    return d
}


const LightweightChartsMultiplePanes: React.VFC = () => {
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"] || []

  const chartsContainerRef = useRef<HTMLDivElement>(null)
  const panes = useRef<PaneMeta[]>([])
  const chartInstances = useRef<(IChartApi | null)[]>([])
  const globalVLineRef = useRef<HTMLDivElement | null>(null)
  const globalMaskRef = useRef<HTMLDivElement | null>(null)

  const primaryTimesRef = useRef<number[]>([])
  const primaryTimesRawRef = useRef<any[]>([])
  const primaryIndexMapRef = useRef<Map<number, number>>(new Map())

  const primarySeriesRef = useRef<any>(null)
  const primaryCandleDataRef = useRef<any[]>([])
  const volumeByTimeRef = useRef<Map<number, number>>(new Map())
  const vpEnabledRef = useRef<boolean>(false)

  const drawModeRef = useRef<DrawMode>("mouse")
  const drawColorRef = useRef<string>("#ffffff")
  const drawWidthRef = useRef<number>(2)

  const drawToolbarRef = useRef<HTMLDivElement | null>(null)
  const drawLayerRef = useRef<SVGSVGElement | null>(null)
  const drawingsRef = useRef<Drawing[]>([])
  const pendingPointRef = useRef<PendingPoint | null>(null)
  const previewRef = useRef<Drawing | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const selectedIdxRef = useRef<number>(-1)

  const isBrushDrawingRef = useRef<boolean>(false)
  
  // ✅ 紀錄上一個畫筆點的螢幕坐標 (用來過濾太近的點)
  const lastBrushPointRef = useRef<{x:number, y:number} | null>(null)

  const chartElRefs = useMemo(() => {
    return Array(chartsData.length)
      .fill(null)
      .map(() => React.createRef<HTMLDivElement>())
  }, [chartsData.length])

  const highlightRangeSig = useMemo(() => {
    const hr = (renderData.args?.["charts"]?.[0] as any)?.highlightRange
    if (!hr) return ""
    return `${hr.start}|${hr.end}`
  }, [renderData.args])

  const timeToIndex = (t: any) => {
    const n = normalizeDate(t)
    if (n == null) return -1
    const key = Math.round(n)
    const idx = primaryIndexMapRef.current.get(key)
    return typeof idx === "number" ? idx : -1
  }

  const renderDrawings = () => {
    const p0 = panes.current[0]
    if (!p0 || !p0.chart || !p0.container) return
    const series = primarySeriesRef.current
    if (!series) return

    const svg = ensureDrawingLayer(p0.container)
    drawLayerRef.current = svg

    const w = p0.container.clientWidth || 1
    const h = p0.container.clientHeight || 1

    svg.setAttribute("viewBox", `0 0 ${w} ${h}`)
    svg.innerHTML = ""

    const ts = p0.chart.timeScale()

    if (vpEnabledRef.current) {
        try {
            const range = ts.getVisibleLogicalRange?.()
            const candles = primaryCandleDataRef.current || []
            const volMap = volumeByTimeRef.current || new Map()
    
            if (candles.length > 0 && range && range.from != null && range.to != null) {
              const from = Math.max(0, Math.floor(Number(range.from)))
              const to = Math.min(candles.length - 1, Math.ceil(Number(range.to)))
              if (to >= from) {
                let minP = Infinity
                let maxP = -Infinity
    
                for (let i = from; i <= to; i++) {
                  const d = candles[i]
                  if (!d) continue
                  const lo = typeof d.low === "number" ? d.low : null
                  const hi = typeof d.high === "number" ? d.high : null
                  if (lo == null || hi == null) continue
                  minP = Math.min(minP, lo)
                  maxP = Math.max(maxP, hi)
                }
    
                if (Number.isFinite(minP) && Number.isFinite(maxP) && maxP > minP) {
                  const bins = 24
                  const step = (maxP - minP) / bins
                  const acc = new Array(bins).fill(0)
    
                  for (let i = from; i <= to; i++) {
                    const d = candles[i]
                    if (!d) continue
    
                    const lo0 = typeof d.low === "number" ? d.low : null
                    const hi0 = typeof d.high === "number" ? d.high : null
                    if (lo0 == null || hi0 == null) continue
    
                    const tNorm = normalizeDate(d.time)
                    if (tNorm == null) continue
                    const key = Math.round(tNorm)
                    const vol = volMap.get(key)
                    if (vol == null || !Number.isFinite(vol) || vol <= 0) continue
    
                    const lo = Math.min(lo0, hi0)
                    const hi = Math.max(lo0, hi0)
    
                    if (Math.abs(hi - lo) < 1e-9) {
                      const bi = Math.max(0, Math.min(bins - 1, Math.floor((lo - minP) / step)))
                      acc[bi] += vol
                      continue
                    }
    
                    const span = hi - lo
                    const bStart = Math.max(0, Math.min(bins - 1, Math.floor((lo - minP) / step)))
                    const bEnd = Math.max(0, Math.min(bins - 1, Math.floor((hi - minP) / step)))
    
                    for (let b = bStart; b <= bEnd; b++) {
                      const binLo = minP + b * step
                      const binHi = minP + (b + 1) * step
                      const overlap = Math.max(0, Math.min(binHi, hi) - Math.max(binLo, lo))
                      if (overlap <= 0) continue
                      acc[b] += vol * (overlap / span)
                    }
                  }
    
                  const maxV = Math.max(...acc)
                  if (maxV > 0) {
                    const maxBarW = Math.min(420, w * 0.62)
                    const xRight = w - 6
                    let maxIdx = -1
                    let secondIdx = -1
                    let maxVal = -Infinity
                    let secondVal = -Infinity
                    for (let b = 0; b < bins; b++) {
                      const v = acc[b]
                      if (v > maxVal) {
                        secondVal = maxVal
                        secondIdx = maxIdx
                        maxVal = v
                        maxIdx = b
                      } else if (v > secondVal) {
                        secondVal = v
                        secondIdx = b
                      }
                    }
    
                    for (let b = 0; b < bins; b++) {
                      const v = acc[b]
                      if (v <= 0) continue
                      const binLo = minP + b * step
                      const binHi = minP + (b + 1) * step
                      const y1c = series.priceToCoordinate(binLo)
                      const y2c = series.priceToCoordinate(binHi)
                      if (y1c == null || y2c == null) continue
                      const y1 = y1c as unknown as number
                      const y2 = y2c as unknown as number
                      if (!Number.isFinite(y1) || !Number.isFinite(y2)) continue
                      const yTop = Math.min(y1, y2)
                      const height = Math.abs(y2 - y1)
                      if (height <= 0.5) continue
                      const barW = (v / maxV) * maxBarW
                      const xLeft = xRight - barW
                      let fill = "rgba(33, 150, 243, 0.18)"
                      let stroke = "rgba(33, 150, 243, 0.35)"
                      if (b === maxIdx) {
                        fill = "rgba(244, 67, 54, 0.22)"
                        stroke = "rgba(244, 67, 54, 0.60)"
                      } else if (b === secondIdx) {
                        fill = "rgba(255, 152, 0, 0.22)"
                        stroke = "rgba(255, 152, 0, 0.60)"
                      }
                      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
                      rect.setAttribute("x", String(xLeft))
                      rect.setAttribute("y", String(yTop))
                      rect.setAttribute("width", String(barW))
                      rect.setAttribute("height", String(height))
                      rect.setAttribute("fill", fill)
                      rect.setAttribute("stroke", stroke)
                      rect.setAttribute("stroke-width", "1")
                      rect.setAttribute("vector-effect", "non-scaling-stroke")
                      svg.appendChild(rect)
                    }
                  }
                }
              }
            }
          } catch (e) { }
    }

    const makeLine = (x1: number, y1: number, x2: number, y2: number, color: string, width: number, dashed: boolean) => {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
      line.setAttribute("x1", String(x1))
      line.setAttribute("y1", String(y1))
      line.setAttribute("x2", String(x2))
      line.setAttribute("y2", String(y2))
      line.setAttribute("stroke", color)
      line.setAttribute("stroke-width", String(width))
      if (dashed) line.setAttribute("stroke-dasharray", "6,4")
      line.setAttribute("vector-effect", "non-scaling-stroke")
      line.setAttribute("stroke-linecap", "round")
      return line
    }

    const makeRect = (x: number, y: number, rw: number, rh: number, color: string, width: number, dashed: boolean) => {
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect")
      r.setAttribute("x", String(x))
      r.setAttribute("y", String(y))
      r.setAttribute("width", String(rw))
      r.setAttribute("height", String(rh))
      r.setAttribute("stroke", color)
      r.setAttribute("stroke-width", String(width))
      r.setAttribute("fill", "rgba(255,255,255,0.06)")
      if (dashed) r.setAttribute("stroke-dasharray", "6,4")
      r.setAttribute("vector-effect", "non-scaling-stroke")
      return r
    }

    const makeCircle = (cx: number, cy: number, color: string, width: number, dashed: boolean) => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle")
      c.setAttribute("cx", String(cx))
      c.setAttribute("cy", String(cy))
      c.setAttribute("r", String(Math.max(3, Math.min(6, width + 2))))
      c.setAttribute("fill", color)
      c.setAttribute("opacity", dashed ? "0.65" : "0.9")
      c.setAttribute("stroke", "rgba(0,0,0,0.35)")
      c.setAttribute("stroke-width", "1")
      return c
    }

    const drawOne = (d: Drawing, dashed: boolean, isSelected: boolean) => {
      const color = d.color
      const width = d.width
      const showPoints = drawModeRef.current === "mouse" && (isSelected || dashed)

      // ✅ 1. 筆刷 (Brush) - 嚴格過濾無效點 + 中點貝茲曲線平滑化
      if (d.mode === "brush" && d.points && d.points.length > 0) {
        const pts: {x:number, y:number}[] = []
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity

        d.points.forEach(pt => {
          const xc = ts.logicalToCoordinate(pt.l as any)
          const yc = series.priceToCoordinate(pt.p)
          
          if (xc != null && yc != null) {
            const x = Number(xc)
            const y = Number(yc)
            
            if (Number.isFinite(x) && Number.isFinite(y)) {
                pts.push({x, y})
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
          }
        })

        if (pts.length > 1) {
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
          
          // ✅ 使用 Midpoint Quadratic Bezier 平滑算法
          const dStr = getSvgPathFromPoints(pts)

          path.setAttribute("d", dStr)
          path.setAttribute("fill", "none")
          path.setAttribute("stroke", color)
          path.setAttribute("stroke-width", String(width))
          path.setAttribute("stroke-linejoin", "round")
          path.setAttribute("stroke-linecap", "round")
          path.setAttribute("vector-effect", "non-scaling-stroke")
          if (dashed) path.setAttribute("opacity", "0.5")
          svg.appendChild(path)

          if (showPoints && isFinite(minX)) {
             const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
             rect.setAttribute("x", String(minX - 5))
             rect.setAttribute("y", String(minY - 5))
             rect.setAttribute("width", String(maxX - minX + 10))
             rect.setAttribute("height", String(maxY - minY + 10))
             rect.setAttribute("stroke", "#2196F3")
             rect.setAttribute("stroke-width", "1")
             rect.setAttribute("stroke-dasharray", "4,4")
             rect.setAttribute("fill", "transparent")
             svg.appendChild(rect)
          }
        }
        return
      }

      // ✅ 2. 斐波那契
      if (d.mode === "fib") {
        const x1c = typeof d.l1 === "number" ? ts.logicalToCoordinate(d.l1 as any) : ts.timeToCoordinate(d.t1)
        const x2c = typeof d.l2 === "number" ? ts.logicalToCoordinate(d.l2 as any) : ts.timeToCoordinate(d.t2)
        const y1c = series.priceToCoordinate(d.p1)
        const y2c = series.priceToCoordinate(d.p2)

        if (x1c == null || x2c == null || y1c == null || y2c == null) return
        const x1 = Number(x1c), x2 = Number(x2c), y1 = Number(y1c), y2 = Number(y2c)

        svg.appendChild(makeLine(x1, y1, x2, y2, color, 1, true))

        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
        const priceDiff = d.p2 - d.p1
        
        levels.forEach(lvl => {
            const levelPrice = d.p1 + (priceDiff * lvl)
            const lyc = series.priceToCoordinate(levelPrice)
            if (lyc != null) {
                const ly = Number(lyc)
                const lxStart = Math.min(x1, x2) - 20
                const lxEnd = Math.max(x1, x2) + 20
                
                const line = makeLine(lxStart, ly, lxEnd, ly, color, 1, false)
                line.setAttribute("opacity", "0.7")
                svg.appendChild(line)
                
                if (showPoints || !dashed) {
                    const text = document.createElementNS("http://www.w3.org/2000/svg", "text")
                    text.setAttribute("x", String(lxStart))
                    text.setAttribute("y", String(ly - 2))
                    text.setAttribute("fill", color)
                    text.setAttribute("font-size", "10")
                    text.textContent = String(lvl)
                    svg.appendChild(text)
                }
            }
        })

        if (showPoints) {
            svg.appendChild(makeCircle(x1, y1, color, width, dashed))
            svg.appendChild(makeCircle(x2, y2, color, width, dashed))
        }
        return
      }

      if (d.mode === "hline") {
        const yc = series.priceToCoordinate(d.p1)
        if (yc == null) return
        const y = yc as unknown as number
        if (!Number.isFinite(y)) return
        svg.appendChild(makeLine(0, y, w, y, color, width, dashed))
        if (showPoints) svg.appendChild(makeCircle(10, y, color, width, dashed))
        return
      }

      const x1c = typeof d.l1 === "number" ? ts.logicalToCoordinate(d.l1 as any) : ts.timeToCoordinate(d.t1)
      const x2c = typeof d.l2 === "number" ? ts.logicalToCoordinate(d.l2 as any) : ts.timeToCoordinate(d.t2)
      const y1c = series.priceToCoordinate(d.p1)
      const y2c = series.priceToCoordinate(d.p2)

      if (x1c == null || x2c == null || y1c == null || y2c == null) return
      const x1 = Number(x1c), x2 = Number(x2c), y1 = Number(y1c), y2 = Number(y2c)

      if (d.mode === "line") {
        svg.appendChild(makeLine(x1, y1, x2, y2, color, width, dashed))
        if (showPoints) {
          svg.appendChild(makeCircle(x1, y1, color, width, dashed))
          svg.appendChild(makeCircle(x2, y2, color, width, dashed))
        }
        return
      }

      if (d.mode === "ray") {
        const xr = w
        let yr: number = y2
        const dx = x2 - x1
        const dy = y2 - y1
        if (Math.abs(dx) < 1e-6) {
          svg.appendChild(makeLine(x1, 0, x1, h, color, width, dashed))
        } else {
          const slope = dy / dx
          yr = y1 + slope * (xr - x1)
          svg.appendChild(makeLine(x1, y1, xr, yr, color, width, dashed))
        }
        if (showPoints) {
            svg.appendChild(makeCircle(x1, y1, color, width, dashed))
            svg.appendChild(makeCircle(x2, y2, color, width, dashed))
        }
        return
      }

      if (d.mode === "rect") {
        const left = Math.min(x1, x2)
        const right = Math.max(x1, x2)
        const top = Math.min(y1, y2)
        const bottom = Math.max(y1, y2)
        const rw = Math.max(0, right - left)
        const rh = Math.max(0, bottom - top)
        if (rw <= 0.5 || rh <= 0.5) {
          svg.appendChild(makeLine(x1, y1, x2, y2, color, width, dashed))
        } else {
          svg.appendChild(makeRect(left, top, rw, rh, color, width, dashed))
        }
        if (showPoints) {
          svg.appendChild(makeCircle(x1, y1, color, width, dashed))
          svg.appendChild(makeCircle(x2, y2, color, width, dashed))
        }
        return
      }
    }

    for (let i = 0; i < drawingsRef.current.length; i++) {
      const d = drawingsRef.current[i]
      const isSel = i === selectedIdxRef.current
      drawOne(d, false, isSel)
    }

    if (previewRef.current) {
      drawOne(previewRef.current, true, true)
    }
  }

  const updateGlobalMask = () => {
    const host = chartsContainerRef.current
    const mask = globalMaskRef.current
    if (!host || !mask) return

    const hr = chartsData?.[0]?.highlightRange
    const times = primaryTimesRef.current 

    if (!hr || !hr.start || !hr.end || !times || times.length === 0 || panes.current.length === 0) {
      mask.style.display = "none"
      return
    }

    const tStart = normalizeDate(hr.start)
    const tEnd = normalizeDate(hr.end)

    if (tStart === null || tEnd === null) {
      mask.style.display = "none"
      return
    }

    let startIdx = -1
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= tStart) {
        startIdx = i
        break
      }
    }

    let endIdx = -1
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] <= tEnd) {
        endIdx = i
        break
      }
    }

    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
      mask.style.display = "none"
      return
    }

    const p0 = panes.current[0]
    if (!p0 || !p0.chart) return

    try {
      const timeScale = p0.chart.timeScale()
      const x1 = timeScale.logicalToCoordinate(startIdx as any)
      const x2 = timeScale.logicalToCoordinate(endIdx as any)
      const safeX1 = x1 ?? -100000
      const safeX2 = x2 ?? -100000

      if (!Number.isFinite(safeX1) || !Number.isFinite(safeX2)) {
        mask.style.display = "none"
        return
      }

      const hostRect = host.getBoundingClientRect()
      const paneRect = p0.container.getBoundingClientRect()
      const offsetX = paneRect.left - hostRect.left
      const offsetY = paneRect.top - hostRect.top
      mask.style.top = `${offsetY}px`
      mask.style.height = `${paneRect.height}px`
      mask.style.bottom = "auto"

      const padding = 3
      const left = Math.min(safeX1, safeX2) - padding
      const right = Math.max(safeX1, safeX2) + padding
      const styleLeft = offsetX + left
      const styleWidth = right - left

      if (!Number.isFinite(styleLeft) || !Number.isFinite(styleWidth) || styleWidth <= 0) {
        mask.style.display = "none"
        return
      }

      mask.style.display = "block"
      mask.style.left = `${styleLeft}px`
      mask.style.width = `${styleWidth}px`
    } catch (e) {
      mask.style.display = "none"
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Backspace") return
      const t = e.target as HTMLElement | null
      if (t) {
        const tag = (t.tagName || "").toUpperCase()
        if (tag === "INPUT" || tag === "TEXTAREA" || (t as any).isContentEditable) return
      }

      if (pendingPointRef.current) {
        e.preventDefault()
        pendingPointRef.current = null
        previewRef.current = null
        isBrushDrawingRef.current = false
        lastBrushPointRef.current = null
        renderDrawings()
        return
      }

      if (selectedIdxRef.current >= 0 && selectedIdxRef.current < drawingsRef.current.length) {
        e.preventDefault()
        drawingsRef.current.splice(selectedIdxRef.current, 1)
        selectedIdxRef.current = -1
        renderDrawings()
        return
      }

      if (drawingsRef.current.length > 0) {
        e.preventDefault()
        drawingsRef.current.pop()
        renderDrawings()
        return
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true } as any)
  }, [])

  useEffect(() => {
    if (!chartsData?.length) return
    if (chartElRefs.some((ref) => !ref.current)) return

    chartInstances.current.forEach((c) => c && c.remove())
    chartInstances.current = []
    panes.current = []
    primaryTimesRef.current = []
    primaryTimesRawRef.current = []
    primaryIndexMapRef.current = new Map()
    primarySeriesRef.current = null
    primaryCandleDataRef.current = []
    volumeByTimeRef.current = new Map()
    selectedIdxRef.current = -1

    const host = chartsContainerRef.current
    if (host) {
      globalVLineRef.current = ensureGlobalVLine(host)
      globalMaskRef.current = ensureGlobalMask(host)

      drawToolbarRef.current = ensureDrawToolbar(
        host,
        () => drawModeRef.current,
        (m) => {
          drawModeRef.current = m
          pendingPointRef.current = null
          previewRef.current = null
          isBrushDrawingRef.current = false
          lastBrushPointRef.current = null
          renderDrawings()
        },
        () => drawColorRef.current,
        (c) => {
          drawColorRef.current = c
          renderDrawings()
        },
        () => drawWidthRef.current,
        (w) => {
          drawWidthRef.current = w
          renderDrawings()
        },
        () => vpEnabledRef.current,
        (v) => {
          vpEnabledRef.current = v
          renderDrawings()
        }
      )

      const mouseLeaveHandler = () => {
        panes.current.forEach((p) => (p.tooltip.style.display = "none"))
        if (globalVLineRef.current) globalVLineRef.current.style.display = "none"
      }
      host.addEventListener("mouseleave", mouseLeaveHandler)
      return () => host.removeEventListener("mouseleave", mouseLeaveHandler)
    }
  }, [chartsData.length])

  useEffect(() => {
    if (!chartsData?.length) return

    chartInstances.current.forEach((c) => c && c.remove())
    chartInstances.current = []
    panes.current = []
    primaryTimesRef.current = []
    primaryTimesRawRef.current = []
    primaryIndexMapRef.current = new Map()
    primarySeriesRef.current = null
    primaryCandleDataRef.current = []
    volumeByTimeRef.current = new Map()
    selectedIdxRef.current = -1
    dragRef.current = null

    const clickSubscriptions: Array<{ chart: IChartApi; handler: (p: MouseEventParams) => void }> = []
    const crosshairSubscriptions: Array<{ chart: IChartApi; handler: (p: MouseEventParams) => void }> = []

    let domMouseDown: ((e: MouseEvent) => void) | null = null
    let domMouseMove: ((e: MouseEvent) => void) | null = null
    let domMouseUp: ((e: MouseEvent) => void) | null = null

    chartElRefs.forEach((ref, i) => {
      const container = ref.current
      if (!container) return

      const chart = createChart(container, {
        height: i === 0 ? 360 : 160,
        width: container.clientWidth || 600,
        ...chartsData[i].chart,
        layout: {
          background: { type: "solid", color: "transparent" },
          textColor: "#d1d4dc",
          ...(chartsData[i].chart?.layout || {}),
        },
        rightPriceScale: {
          visible: true,
          minimumWidth: 70,
          borderColor: "rgba(197, 203, 206, 0.8)",
          ...(chartsData[i].chart?.rightPriceScale || {}),
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          ...(chartsData[i].chart?.timeScale || {}),
        },
      })

      chart.applyOptions({
        crosshair: {
          mode: 1,
          vertLine: {
            visible: false,
            labelBackgroundColor: "#4c525e",
          },
          horzLine: {
            visible: true,
            labelBackgroundColor: "#4c525e",
          },
        },
      })

      chartInstances.current[i] = chart
      const tooltip = ensurePaneTooltip(container)
      panes.current[i] = { chart, container, tooltip, series: [] }

      for (const s of chartsData[i].series) {
        let api: ISeriesApi<any> | null = null
        switch (s.type) {
          case "Candlestick":
            api = chart.addCandlestickSeries(s.options)
            break
          case "Histogram":
            api = chart.addHistogramSeries(s.options)
            break
          case "Line":
            api = chart.addLineSeries(s.options)
            break
          case "Area":
            api = chart.addAreaSeries(s.options)
            break
          case "Bar":
            api = chart.addBarSeries(s.options)
            break
          case "Baseline":
            api = chart.addBaselineSeries(s.options)
            break
        }

        if (api) {
          if (s.type !== "Candlestick") {
            try {
              ;(api as any).applyOptions({ crosshairMarkerVisible: false })
            } catch (e) {}
          }

          if (s.priceScale) chart.priceScale(s.options?.priceScaleId || "").applyOptions(s.priceScale)

          api.setData(s.data)
          if (s.markers) api.setMarkers(s.markers)

          if (i === 0 && s.type === "Candlestick" && Array.isArray(s.data)) {
            primaryCandleDataRef.current = s.data
            const rawArr: any[] = []
            const normArr: number[] = []
            const idxMap = new Map<number, number>()
            s.data.forEach((d: any) => {
              const n = normalizeDate(d.time)
              if (n !== null) {
                const key = Math.round(n)
                const idx = normArr.length
                rawArr.push(d.time)
                normArr.push(n)
                idxMap.set(key, idx)
              }
            })
            primaryTimesRawRef.current = rawArr
            primaryTimesRef.current = normArr
            primaryIndexMapRef.current = idxMap
            primarySeriesRef.current = api
          }

          if (i === 1 && s.type === "Histogram" && Array.isArray(s.data)) {
            const m = volumeByTimeRef.current
            s.data.forEach((d: any) => {
              const n = normalizeDate(d.time)
              const v = typeof d.value === "number" ? d.value : null
              if (n != null && v != null && Number.isFinite(v)) {
                m.set(Math.round(n), v)
              }
            })
          }

          panes.current[i].series.push({
            api,
            title: (api.options() as any).title || s.options?.title || "",
            options: api.options(),
          })
        }
      }
      chart.timeScale().fitContent()
    })

    const syncCrosshair = (sourceChart: IChartApi, param: MouseEventParams, sourcePaneIndex: number) => {
      const vline = globalVLineRef.current
      const host = chartsContainerRef.current
      if (!vline || !host || !param.point || !param.time) {
        panes.current.forEach((p) => (p.tooltip.style.display = "none"))
        if (vline) vline.style.display = "none"
        return
      }
      try {
        const sourcePane = panes.current[sourcePaneIndex]
        if (!sourcePane || !sourcePane.chart) return
        const rawX = sourcePane.chart.timeScale().timeToCoordinate(param.time)
        if (rawX === null) return
        const hostRect = host.getBoundingClientRect()
        const srcRect = sourcePane.container.getBoundingClientRect()
        const absoluteX = srcRect.left - hostRect.left + rawX
        vline.style.left = `${absoluteX}px`
        vline.style.display = "block"
      } catch (e) {
        return
      }
      panes.current.forEach((target, idx) => {
        try {
          if (!target || !target.chart) return
          const timeStr = formatTime(param.time)
          const logical = sourceChart.timeScale().coordinateToLogical((param.point as any)!.x)
          if (logical !== null) {
            updatePaneTooltip(target, timeStr, Math.round(logical))
          }
          if (idx !== sourcePaneIndex) {
            if (target.chart) {
              target.chart.setCrosshairPosition(0, param.time!, target.series[0]?.api)
            }
          }
        } catch (e) {}
      })
    }

    panes.current.forEach((p, idx) => {
      p.chart.subscribeCrosshairMove((param) => syncCrosshair(p.chart, param, idx))
    })

    const validCharts = chartInstances.current.filter((c): c is IChartApi => c !== null)
    if (validCharts.length > 1) {
      let isSyncing = false
      validCharts.forEach((chart) => {
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (!range || isSyncing) return
          isSyncing = true
          validCharts
            .filter((c) => c !== chart)
            .forEach((c) => {
              try {
                c.timeScale().setVisibleLogicalRange(range)
              } catch (e) {}
            })
          isSyncing = false
          requestAnimationFrame(updateGlobalMask)
          requestAnimationFrame(renderDrawings)
        })
      })
    } else if (validCharts.length === 1) {
      validCharts[0].timeScale().subscribeVisibleLogicalRangeChange(() => {
        requestAnimationFrame(updateGlobalMask)
        requestAnimationFrame(renderDrawings)
      })
    }

    try {
      const c0 = chartInstances.current[0]
      const n = primaryTimesRef.current.length
      if (c0 && n > 0) {
        const from = Math.max(0, n - 60)
        const to = n - 1
        c0.timeScale().setVisibleLogicalRange({ from, to })
      }
    } catch (e) {}

    try {
      const c0 = chartInstances.current[0]
      if (c0) {
        const handler = (param: MouseEventParams) => {
          if (!param || !param.point) return
          
          if (drawModeRef.current === "brush") return 

          if (!pendingPointRef.current) return

          const series = primarySeriesRef.current
          const p0 = panes.current[0]
          if (!series || !p0 || !p0.chart) return

          const pp = pendingPointRef.current
          const modeNow = pp.mode

          const logical2 = p0.chart.timeScale().coordinateToLogical((param.point as any).x)
          if (logical2 == null) return

          let price: number | null = null
          try {
            price = series.coordinateToPrice((param.point as any).y) as any
          } catch (e) {
            price = null
          }
          if (price == null || !Number.isFinite(price)) return

          if (modeNow === "hline") {
            previewRef.current = {
              mode: "hline",
              t1: pp.t,
              p1: pp.p,
              t2: pp.t,
              p2: pp.p,
              color: drawColorRef.current,
              width: drawWidthRef.current,
              l1: pp.l,
              l2: pp.l,
            }
            renderDrawings()
            return
          }

          const dm: DrawingMode = modeNow === "fib" ? "fib" : modeNow === "ray" ? "ray" : modeNow === "rect" ? "rect" : "line"

          previewRef.current = {
            mode: dm,
            t1: pp.t,
            p1: pp.p,
            t2: (param as any).time ?? null,
            p2: price,
            color: drawColorRef.current,
            width: drawWidthRef.current,
            l1: pp.l,
            l2: Number(logical2),
          }
          renderDrawings()
        }

        c0.subscribeCrosshairMove(handler)
        crosshairSubscriptions.push({ chart: c0, handler })
      }
    } catch (e) {}

    try {
      const c0 = chartInstances.current[0]
      if (c0) {
        const handler = (param: MouseEventParams) => {
          if (drawModeRef.current === "mouse") return
          if (!param || !param.point) return

          const p0 = panes.current[0]
          const series = primarySeriesRef.current
          if (!series || !p0 || !p0.chart) return

          const logical = p0.chart.timeScale().coordinateToLogical((param.point as any).x)
          if (logical == null) return

          let price: number | null = null
          try {
            price = series.coordinateToPrice((param.point as any).y) as any
          } catch (e) {
            price = null
          }
          if (price == null || !Number.isFinite(price)) return

          const t = (param as any).time ?? null
          const mode = drawModeRef.current

          if (mode === "brush") return

          if (mode === "hline") {
            pendingPointRef.current = null
            previewRef.current = null
            const newDrawing: Drawing = {
              mode: "hline",
              t1: t,
              p1: price,
              t2: t,
              p2: price,
              color: drawColorRef.current,
              width: drawWidthRef.current,
              l1: Number(logical),
              l2: Number(logical),
            }
            drawingsRef.current.push(newDrawing)
            renderDrawings()
            return
          }

          if (!pendingPointRef.current) {
            pendingPointRef.current = { mode, t, p: price, l: Number(logical) }
            const dm: DrawingMode = mode === "fib" ? "fib" : mode === "ray" ? "ray" : mode === "rect" ? "rect" : "line"
            previewRef.current = {
              mode: dm,
              t1: t,
              p1: price,
              t2: t,
              p2: price,
              color: drawColorRef.current,
              width: drawWidthRef.current,
              l1: Number(logical),
              l2: Number(logical),
            }
            renderDrawings()
            return
          }

          const p1 = pendingPointRef.current
          pendingPointRef.current = null
          const dMode: DrawingMode = p1.mode === "fib" ? "fib" : p1.mode === "ray" ? "ray" : p1.mode === "rect" ? "rect" : "line"

          const newDrawing: Drawing = {
            mode: dMode,
            t1: p1.t,
            p1: p1.p,
            t2: t,
            p2: price,
            color: drawColorRef.current,
            width: drawWidthRef.current,
            l1: p1.l,
            l2: Number(logical),
          }

          drawingsRef.current.push(newDrawing)
          previewRef.current = null
          renderDrawings()
        }

        c0.subscribeClick(handler)
        clickSubscriptions.push({ chart: c0, handler })
      }
    } catch (e) {}

    try {
      const p0 = panes.current[0]
      const chart0 = chartInstances.current[0]
      const series = primarySeriesRef.current
      if (p0 && p0.container && chart0 && series) {
        const container = p0.container

        const distPointToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
          const vx = x2 - x1
          const vy = y2 - y1
          const wx = px - x1
          const wy = py - y1
          const c1 = vx * wx + vy * wy
          if (c1 <= 0) return Math.hypot(px - x1, py - y1)
          const c2 = vx * vx + vy * vy
          if (c2 <= c1) return Math.hypot(px - x2, py - y2)
          const b = c1 / c2
          const bx = x1 + b * vx
          const by = y1 + b * vy
          return Math.hypot(px - bx, py - by)
        }

        const getDrawingCoords = (d: Drawing) => {
          const ts = chart0.timeScale()
          const w = container.clientWidth || 1
          const h = container.clientHeight || 1

          if (d.mode === "brush" && d.points) {
             let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity
             d.points.forEach(pt => {
                 const x = ts.logicalToCoordinate(pt.l as any)
                 const y = series.priceToCoordinate(pt.p)
                 if (x!=null && y!=null) {
                     const nx = Number(x), ny = Number(y)
                     minX = Math.min(minX, nx); maxX = Math.max(maxX, nx)
                     minY = Math.min(minY, ny); maxY = Math.max(maxY, ny)
                 }
             })
             return { kind: "rect", rect: { left: minX-5, right: maxX+5, top: minY-5, bottom: maxY+5 }, w, h, p1: {x: minX, y: minY}, p2: {x: maxX, y: maxY} }
          }

          if (d.mode === "hline") {
            const yc = series.priceToCoordinate(d.p1)
            if (yc == null) return null
            const y = yc as unknown as number
            if (!Number.isFinite(y)) return null
            return {
              kind: "hline" as const,
              p1: { x: 10, y },
              p2: { x: 10, y },
              body: { x1: 0, y1: y, x2: w, y2: y },
              w,
              h,
            }
          }

          const x1c = typeof d.l1 === "number" ? ts.logicalToCoordinate(d.l1 as any) : ts.timeToCoordinate(d.t1)
          const x2c = typeof d.l2 === "number" ? ts.logicalToCoordinate(d.l2 as any) : ts.timeToCoordinate(d.t2)
          const y1c = series.priceToCoordinate(d.p1)
          const y2c = series.priceToCoordinate(d.p2)
          if (x1c == null || x2c == null || y1c == null || y2c == null) return null

          const x1 = Number(x1c), x2 = Number(x2c), y1 = Number(y1c), y2 = Number(y2c)

          if (d.mode === "ray") {
            const xr = w
            let yr = y2
            const dx = x2 - x1
            const dy = y2 - y1
            if (Math.abs(dx) < 1e-6) {
              return { kind: "rayV", p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, body: { x1: x1, y1: 0, x2: x1, y2: h }, w, h }
            }
            const slope = dy / dx
            yr = y1 + slope * (xr - x1)
            return { kind: "ray", p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, body: { x1: x1, y1: y1, x2: xr, y2: yr }, w, h }
          }

          if (d.mode === "rect") {
            const left = Math.min(x1, x2)
            const right = Math.max(x1, x2)
            const top = Math.min(y1, y2)
            const bottom = Math.max(y1, y2)
            return { kind: "rect", p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, rect: { left, right, top, bottom }, w, h }
          }

          return { kind: "line", p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, body: { x1: x1, y1: y1, x2: x2, y2: y2 }, w, h }
        }

        const findHit = (mx: number, my: number) => {
          const handleThresh = 10
          const bodyThresh = 7

          const checkOne = (idx: number) => {
            const d = drawingsRef.current[idx]
            if (!d) return null
            const coords = getDrawingCoords(d)
            if (!coords) return null

            if (d.mode === "brush" && (coords as any).rect) {
                const { left, right, top, bottom } = (coords as any).rect
                if (mx >= left && mx <= right && my >= top && my <= bottom) {
                    return { idx, part: "body" as DragPart, dist: 0 }
                }
                return null
            }

            const p1d = Math.hypot(mx - coords.p1.x, my - coords.p1.y)
            const p2d = Math.hypot(mx - coords.p2.x, my - coords.p2.y)

            let bestPart: DragPart | null = null
            let bestDist = Infinity

            if (d.mode === "hline") {
              if (p1d <= handleThresh) { bestPart = "p1"; bestDist = p1d; }
            } else {
              if (p1d <= handleThresh && p1d < bestDist) { bestPart = "p1"; bestDist = p1d; }
              if (p2d <= handleThresh && p2d < bestDist) { bestPart = "p2"; bestDist = p2d; }
            }

            if (bestPart) return { idx, part: bestPart, dist: bestDist }

            if (d.mode === "rect" && (coords as any).rect) {
              const { left, right, top, bottom } = (coords as any).rect
              const d1 = distPointToSegment(mx, my, left, top, right, top)
              const d2 = distPointToSegment(mx, my, right, top, right, bottom)
              const d3 = distPointToSegment(mx, my, right, bottom, left, bottom)
              const d4 = distPointToSegment(mx, my, left, bottom, left, top)
              const dd = Math.min(d1, d2, d3, d4)
              if (dd <= bodyThresh) return { idx, part: "body" as DragPart, dist: dd }
            } else if ((coords as any).body) {
              const b = (coords as any).body
              const dd = distPointToSegment(mx, my, b.x1, b.y1, b.x2, b.y2)
              if (dd <= bodyThresh) return { idx, part: "body" as DragPart, dist: dd }
            } else if (d.mode === "hline" && (coords as any).kind === "hline") {
                const dd = Math.abs(my - coords.p1.y)
                if (dd <= bodyThresh) return { idx, part: "body" as DragPart, dist: dd }
            }

            return null
          }

          const sel = selectedIdxRef.current
          if (sel >= 0 && sel < drawingsRef.current.length) {
            const rSel = checkOne(sel)
            if (rSel) return rSel
          }

          let best: { idx: number; part: DragPart; dist: number } | null = null
          for (let i = 0; i < drawingsRef.current.length; i++) {
            const r = checkOne(i)
            if (!r) continue
            if (!best || r.dist < best.dist) best = r
          }
          return best
        }

        domMouseDown = (e: MouseEvent) => {
          if (!series || !chart0) return
          const rect = container.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top

          // ✅ 筆刷模式：開始畫
          if (drawModeRef.current === "brush") {
              const ts = chart0.timeScale()
              const logical = ts.coordinateToLogical(mx as any)
              const price = series.coordinateToPrice(my as any)
              
              if (logical != null && price != null) {
                  isBrushDrawingRef.current = true
                  lastBrushPointRef.current = {x: mx, y: my} // 初始化最後點

                  const newDrawing: Drawing = {
                      mode: "brush",
                      t1: null, p1: 0, t2: null, p2: 0, 
                      color: drawColorRef.current,
                      width: drawWidthRef.current,
                      points: [{ l: Number(logical), p: Number(price) }]
                  }
                  drawingsRef.current.push(newDrawing)
                  selectedIdxRef.current = drawingsRef.current.length - 1
                  renderDrawings()
              }
              try { e.stopPropagation() } catch (err) {}
              return
          }

          if (drawModeRef.current !== "mouse") return

          if (drawingsRef.current.length === 0) {
            selectedIdxRef.current = -1
            renderDrawings()
            return
          }

          const hit = findHit(mx, my)
          if (!hit) {
            selectedIdxRef.current = -1
            renderDrawings()
            container.style.cursor = ""
            return
          }

          selectedIdxRef.current = hit.idx
          renderDrawings()

          try { e.preventDefault(); e.stopPropagation() } catch (err) {}

          const ts = chart0.timeScale()
          const logical = ts.coordinateToLogical(mx as any)
          const price = series.coordinateToPrice(my as any) as any
          if (logical == null || price == null) return

          const d = drawingsRef.current[hit.idx]
          const orig: Drawing = { ...d }
          if (orig.points) orig.points = [...orig.points] 

          const ol1 = typeof d.l1 === "number" ? Number(d.l1) : timeToIndex(d.t1)
          const ol2 = typeof d.l2 === "number" ? Number(d.l2) : timeToIndex(d.t2)

          dragRef.current = {
            idx: hit.idx,
            orig,
            startLogical: Number(logical),
            startPrice: Number(price),
            origL1: ol1,
            origL2: ol2,
            part: hit.part,
          }
          container.style.cursor = "grabbing"
        }

        domMouseMove = (e: MouseEvent) => {
          if (!series || !chart0) return
          const rect = container.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top

          // ✅ 筆刷繪製：加入距離檢測 + 嚴格過濾
          if (drawModeRef.current === "brush" && isBrushDrawingRef.current) {
             
             // 1. 檢查與上一點的螢幕距離，小於 5px 則忽略 (防止過密導致方塊感)
             if (lastBrushPointRef.current) {
                 const dist = Math.hypot(mx - lastBrushPointRef.current.x, my - lastBrushPointRef.current.y)
                 if (dist < 5) return
             }
             
             const ts = chart0.timeScale()
             const logical = ts.coordinateToLogical(mx as any)
             const price = series.coordinateToPrice(my as any)
             
             if (logical != null && price != null) {
                 const l = Number(logical)
                 const p = Number(price)
                 
                 // 確保數值有效
                 if (Number.isFinite(l) && Number.isFinite(p)) {
                     const currentDrawing = drawingsRef.current[drawingsRef.current.length - 1]
                     if (currentDrawing && currentDrawing.points) {
                         currentDrawing.points.push({ l, p })
                         lastBrushPointRef.current = {x: mx, y: my} // 更新最後點
                         renderDrawings()
                     }
                 }
             }
             return
          }

          if (drawModeRef.current !== "mouse") return

          if (!dragRef.current) {
            const hit = drawingsRef.current.length > 0 ? findHit(mx, my) : null
            if (!hit) {
              container.style.cursor = ""
              return
            }
            container.style.cursor = hit.part === "body" ? "grab" : "pointer"
            return
          }

          try { e.preventDefault(); e.stopPropagation() } catch (err) {}

          const ts = chart0.timeScale()
          const logicalNow = ts.coordinateToLogical(mx as any)
          const priceNow = series.coordinateToPrice(my as any) as any
          if (logicalNow == null || priceNow == null) return

          const st = dragRef.current
          const orig = st.orig
          const updated: Drawing = { ...drawingsRef.current[st.idx] }

          const deltaLogical = Number(logicalNow) - st.startLogical
          const deltaPrice = Number(priceNow) - st.startPrice

          if (updated.mode === "brush" && updated.points && orig.points) {
              updated.points = orig.points.map(p => ({
                  l: p.l + deltaLogical,
                  p: p.p + deltaPrice
              }))
              drawingsRef.current[st.idx] = updated
              renderDrawings()
              return
          }

          if (st.part === "p1" || st.part === "p2") {
            if (orig.mode === "hline") {
              updated.p1 = Number(priceNow)
              updated.p2 = updated.p1
              updated.l1 = Number(logicalNow)
              updated.l2 = Number(logicalNow)
            } else if (st.part === "p1") {
              updated.p1 = Number(priceNow)
              updated.l1 = Number(logicalNow)
            } else {
              updated.p2 = Number(priceNow)
              updated.l2 = Number(logicalNow)
            }
            drawingsRef.current[st.idx] = updated
            renderDrawings()
            return
          }

          if (orig.mode === "hline") {
            updated.p1 = orig.p1 + deltaPrice
            updated.p2 = updated.p1
            updated.l1 = st.origL1 + deltaLogical
            updated.l2 = st.origL2 + deltaLogical
          } else {
            updated.l1 = st.origL1 + deltaLogical
            updated.l2 = st.origL2 + deltaLogical
            updated.p1 = orig.p1 + deltaPrice
            updated.p2 = orig.p2 + deltaPrice
          }

          drawingsRef.current[st.idx] = updated
          renderDrawings()
        }

        domMouseUp = (e: MouseEvent) => {
          if (isBrushDrawingRef.current) {
              isBrushDrawingRef.current = false
              lastBrushPointRef.current = null
              return
          }

          if (!dragRef.current) return
          try { e.preventDefault(); e.stopPropagation() } catch (err) {}
          dragRef.current = null
          container.style.cursor = ""
        }

        container.addEventListener("mousedown", domMouseDown, true)
        window.addEventListener("mousemove", domMouseMove, true)
        window.addEventListener("mouseup", domMouseUp, true)
      }
    } catch (e) {}

    setTimeout(updateGlobalMask, 100)
    setTimeout(renderDrawings, 120)

    const ro = new ResizeObserver(() => {
      panes.current.forEach((p, idx) => {
        try { if (p.chart) p.chart.resize(p.container.clientWidth, idx === 0 ? 360 : 160) } catch (e) {}
      })
      updateGlobalMask()
      renderDrawings()
    })
    if (chartsContainerRef.current) ro.observe(chartsContainerRef.current)

    return () => {
      ro.disconnect()
      clickSubscriptions.forEach(({ chart, handler }) => { try { (chart as any).unsubscribeClick(handler) } catch (e) {} })
      crosshairSubscriptions.forEach(({ chart, handler }) => { try { (chart as any).unsubscribeCrosshairMove(handler) } catch (e) {} })
      try {
        const p0 = panes.current[0]
        if (p0 && p0.container && domMouseDown) p0.container.removeEventListener("mousedown", domMouseDown, true)
        if (domMouseMove) window.removeEventListener("mousemove", domMouseMove, true)
        if (domMouseUp) window.removeEventListener("mouseup", domMouseUp, true)
      } catch (e) {}
      panes.current = []
      const oldCharts = [...chartInstances.current]
      chartInstances.current = []
      oldCharts.forEach((c) => { if (c) try { c.remove() } catch (e) {} })
    }
  }, [chartsData])

  useEffect(() => {
    updateGlobalMask()
  }, [highlightRangeSig])

  return (
    <div ref={chartsContainerRef} style={{ position: "relative" }}>
      {chartElRefs.map((ref, i) => (
        <div ref={ref} key={i} className="chart-pane" />
      ))}
    </div>
  )
}

const updatePaneTooltip = (pane: PaneMeta, timeStr: string, logical: number) => {
  const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
  const floatFmt = (v: any, digits = 2) => toFixedMaybe(v, digits)
  let html = `<div style="font-weight:bold;margin-bottom:4px;">日期：${timeStr}</div>`

  pane.series.forEach((s) => {
    try {
      const data = s.api.dataByIndex(logical) as any
      if (!data) return

      let valStr = "--"
      let color = "#fff"
      const opts = s.options as any
      const rawTitle = (s.title || "").trim()
      const isKDorRSI = /^(K|D|RSI)$/i.test(rawTitle)
      const isHouseCount = /家數/.test(rawTitle)
      const isVolumeOrShares = !isHouseCount && /成交量|VOLUME|量|張|買賣|融資|融券/.test(rawTitle)
      const isIntegerType = isHouseCount || isVolumeOrShares
      const wantsPercentAfterValue = /大戶|散戶|%|％/.test(rawTitle) && !isKDorRSI
      let displayTitle = rawTitle.replace(/[%％]/g, "").trim()

      if (isHouseCount) {
        displayTitle = displayTitle.replace(/\(張\)/g, "(家)")
        if (!/\(家\)/.test(displayTitle)) displayTitle = `${displayTitle} (家)`
      } else if (isVolumeOrShares) {
        if (!/\(張\)/.test(displayTitle) && !/張/.test(displayTitle)) displayTitle = `${displayTitle} (張)`
      }

      if (data.close !== undefined) {
        const isUp = data.close >= data.open
        color = isUp ? opts.upColor : opts.downColor
        let base = data.open
        let prevClose: any = null
        try {
          const prev = s.api.dataByIndex(logical - 1) as any
          if (prev && typeof prev.close === "number") prevClose = prev.close
        } catch (e) {}
        if (typeof prevClose === "number" && Number.isFinite(prevClose) && prevClose !== 0) base = prevClose
        let pct = 0
        if (typeof base === "number" && Number.isFinite(base) && base !== 0) {
          pct = ((data.close - base) / base) * 100
        }
        const pctStr = `${pct >= 0 ? "+" : ""}${floatFmt(pct, 2)}%`
        valStr = `開:${floatFmt(data.open)} 高:${floatFmt(data.high)} 低:${floatFmt(data.low)} 收:${floatFmt(
          data.close
        )}  漲跌幅:${pctStr}`
      } else if (data.value !== undefined) {
        if (isIntegerType) {
          const v = typeof data.value === "number" ? Math.round(data.value) : 0
          valStr = intFmt.format(v)
        } else {
          valStr = floatFmt(data.value, 2)
        }
        if (wantsPercentAfterValue && valStr !== "--") {
          valStr = `${valStr}%`
        }
        if (data.color) color = data.color
        else if (opts.color) color = opts.color
        else if (opts.lineColor) color = opts.lineColor
      }
      const gap = /^MA\d+$/i.test(displayTitle) ? 6 : 12
      html += `<div style="display:flex;align-items:center;justify-content:flex-start;gap:${gap}px;color:${color}">
                <span>${displayTitle}</span>
                <span style="font-family:monospace">${valStr}</span>
              </div>`
    } catch (e) {}
  })
  pane.tooltip.innerHTML = html
  pane.tooltip.style.display = "block"
}

export default LightweightChartsMultiplePanes