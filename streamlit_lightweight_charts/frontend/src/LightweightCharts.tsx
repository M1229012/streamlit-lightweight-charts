import { useRenderData } from "streamlit-component-lib-react-hooks"
import { createChart, IChartApi, MouseEventParams, ISeriesApi } from "lightweight-charts"
import React, { useRef, useEffect, useMemo } from "react"

// ====================================================================
// 1. 輔助函式：統一日期處理 (解決 String vs Object 比較失敗的問題)
// ====================================================================

// 將任何格式的日期 (String 'YYYY-MM-DD', Object {year,month,day}, Number timestamp)
// 統一轉換為 UNIX Timestamp (秒) 以便比較
function normalizeDate(d: any): number | null {
  if (d == null) return null

  // 1. 如果已經是數字 (Unix Timestamp)
  if (typeof d === "number") return d

  // 2. 如果是字串 (YYYY-MM-DD)
  if (typeof d === "string") {
    const dateObj = new Date(d)
    if (!isNaN(dateObj.getTime())) {
      // 處理時區問題，這裡簡單用 UTC
      return dateObj.getTime() / 1000
    }
    return null
  }

  // 3. 如果是 Lightweight Charts 的物件格式 { year: 2023, month: 1, day: 1 }
  if (typeof d === "object" && "year" in d && "month" in d && "day" in d) {
    const dateObj = new Date(d.year, d.month - 1, d.day)
    return dateObj.getTime() / 1000
  }

  return null
}

function formatTime(t: any) {
  if (t == null) return ""
  // 嘗試轉成 Date 物件輸出字串
  if (typeof t === "number") {
    const d = new Date(t * 1000)
    return d.toISOString().split("T")[0] // YYYY-MM-DD
  }
  if (typeof t === "object" && "year" in t) {
    const y = t.year
    const m = String(t.month).padStart(2, "0")
    const d = String(t.day).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  return String(t)
}

function pickValue(d: any) {
  if (!d) return null
  if (typeof d === "number") return d
  if (typeof d.value === "number") return d.value
  if (typeof d.close === "number") return d.close
  return null
}

function toFixedMaybe(v: any, digits = 2) {
  if (v == null || Number.isNaN(v)) return "--"
  if (typeof v !== "number") return String(v)
  return v.toFixed(digits)
}

// ====================================================================
// 2. DOM 元素建立 (Tooltip, VLine, Mask)
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
      zIndex: "1000", // Tooltip 在最上層
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
      zIndex: "900", // 十字線
      transform: "translateX(-0.5px)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(line)
  }
  return line
}

// 建立全域遮罩 (黃色背景區塊)
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
      // ✅ 關鍵：確保遮罩在 Canvas 之上、但在 VLine/Tooltip 之下
      zIndex: "800",
      // ✅ 樣式：半透明黃色 (模仿籌碼K線)
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
// 2.1 畫線工具 DOM (Toolbar + SVG overlay)
// ====================================================================

type DrawMode = "mouse" | "line" | "ray" | "hline"

function setToolbarActive(toolbar: HTMLDivElement, mode: DrawMode) {
  const btns = toolbar.querySelectorAll("button[data-mode]") as NodeListOf<HTMLButtonElement>
  btns.forEach((b) => {
    const m = (b.getAttribute("data-mode") || "mouse") as DrawMode
    const isActive = m === mode
    Object.assign(b.style, {
      background: isActive ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)",
      border: isActive ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.18)",
      color: isActive ? "#fff" : "rgba(255,255,255,0.85)",
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
      top: "8px",
      right: "8px",
      zIndex: "1100",
      display: "flex",
      gap: "6px",
      padding: "6px",
      borderRadius: "8px",
      background: "rgba(15, 15, 15, 0.55)",
      border: "1px solid rgba(255,255,255,0.12)",
      backdropFilter: "blur(6px)",
      pointerEvents: "auto",
      userSelect: "none",
      alignItems: "center",
    })

    const mkBtn = (label: string, mode: DrawMode) => {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = label
      b.setAttribute("data-mode", mode)
      Object.assign(b.style, {
        fontSize: "12px",
        padding: "6px 10px",
        borderRadius: "6px",
        cursor: "pointer",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: "rgba(255,255,255,0.85)",
      })
      b.addEventListener("click", () => {
        setMode(mode)
        setToolbarActive(toolbar!, getMode())
      })
      return b
    }

    const divider = () => {
      const d = document.createElement("div")
      Object.assign(d.style, {
        width: "1px",
        height: "22px",
        background: "rgba(255,255,255,0.18)",
        margin: "0 4px",
      })
      return d
    }

    const mkLabel = (txt: string) => {
      const s = document.createElement("span")
      s.textContent = txt
      Object.assign(s.style, {
        fontSize: "12px",
        color: "rgba(255,255,255,0.75)",
        marginLeft: "2px",
        marginRight: "2px",
      })
      return s
    }

    const colorInput = document.createElement("input")
    colorInput.type = "color"
    colorInput.value = getColor()
    Object.assign(colorInput.style, {
      width: "28px",
      height: "22px",
      padding: "0",
      border: "1px solid rgba(255,255,255,0.18)",
      borderRadius: "6px",
      background: "transparent",
      cursor: "pointer",
    })
    colorInput.addEventListener("input", () => {
      setColor(colorInput.value)
    })

    const widthSel = document.createElement("select")
    Object.assign(widthSel.style, {
      height: "22px",
      fontSize: "12px",
      borderRadius: "6px",
      background: "#ffffff",
      color: "#000000", // ✅ 字改黑色
      border: "1px solid rgba(255,255,255,0.18)",
      padding: "0 6px",
      cursor: "pointer",
      outline: "none",
    })
    ;[1, 2, 3, 4, 5, 6].forEach((n) => {
      const opt = document.createElement("option")
      opt.value = String(n)
      opt.textContent = String(n)
      Object.assign(opt.style, {
        backgroundColor: "#ffffff",
        color: "#000000", // ✅ option 字改黑色
      })
      widthSel.appendChild(opt)
    })
    widthSel.value = String(getWidth())
    widthSel.addEventListener("change", () => {
      const v = parseInt(widthSel.value, 10)
      if (Number.isFinite(v)) setWidth(v)
    })

    // ✅ 分價圖按鈕（開/關）
    const vpBtn = document.createElement("button")
    vpBtn.type = "button"
    vpBtn.className = "vp-toggle"
    Object.assign(vpBtn.style, {
      fontSize: "12px",
      padding: "6px 10px",
      borderRadius: "6px",
      cursor: "pointer",
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.18)",
      color: "rgba(255,255,255,0.85)",
      marginLeft: "2px",
    })
    const syncVPBtn = () => {
      const on = getVP()
      vpBtn.textContent = on ? "分價圖：開" : "分價圖：關"
      Object.assign(vpBtn.style, {
        background: on ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)",
        border: on ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.18)",
        color: on ? "#fff" : "rgba(255,255,255,0.85)",
      })
    }
    vpBtn.addEventListener("click", () => {
      setVP(!getVP())
      syncVPBtn()
    })
    syncVPBtn()

    // ✅ 中文
    toolbar.appendChild(mkBtn("滑鼠", "mouse"))
    toolbar.appendChild(mkBtn("直線", "line"))
    toolbar.appendChild(mkBtn("延長線", "ray"))
    toolbar.appendChild(mkBtn("水平線", "hline"))

    toolbar.appendChild(divider())
    toolbar.appendChild(vpBtn)

    toolbar.appendChild(divider())
    toolbar.appendChild(mkLabel("顏色"))
    toolbar.appendChild(colorInput)
    toolbar.appendChild(mkLabel("粗細"))
    toolbar.appendChild(widthSel)

    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(toolbar)
  }

  // 同步 UI 狀態
  setToolbarActive(toolbar, getMode())
  const ci = toolbar.querySelector('input[type="color"]') as HTMLInputElement | null
  if (ci) ci.value = getColor()
  const ws = toolbar.querySelector("select") as HTMLSelectElement | null
  if (ws) ws.value = String(getWidth())

  const vpBtn = toolbar.querySelector(".vp-toggle") as HTMLButtonElement | null
  if (vpBtn) {
    const on = getVP()
    vpBtn.textContent = on ? "分價圖：開" : "分價圖：關"
    Object.assign(vpBtn.style, {
      background: on ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)",
      border: on ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.18)",
      color: on ? "#fff" : "rgba(255,255,255,0.85)",
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

type DrawingMode = "line" | "ray" | "hline"

type Drawing = {
  mode: DrawingMode
  t1: any
  p1: number
  t2: any
  p2: number
  color: string
  width: number
}

type PendingPoint = {
  mode: DrawMode
  t: any
  p: number
}

type DragState = {
  idx: number
  orig: Drawing
  startLogical: number
  startPrice: number
  origIdx1: number
  origIdx2: number
}

const LightweightChartsMultiplePanes: React.VFC = () => {
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"] || []

  const chartsContainerRef = useRef<HTMLDivElement>(null)
  const panes = useRef<PaneMeta[]>([])
  const chartInstances = useRef<(IChartApi | null)[]>([])
  const globalVLineRef = useRef<HTMLDivElement | null>(null)
  const globalMaskRef = useRef<HTMLDivElement | null>(null)

  // 儲存主圖的時間序列 (用於計算遮罩位置)
  const primaryTimesRef = useRef<number[]>([])
  // 儲存主圖原始 time（用於拖曳後回填成同一種 time 型別）
  const primaryTimesRawRef = useRef<any[]>([])
  // 快速查 index：key = round(normalized_ts)
  const primaryIndexMapRef = useRef<Map<number, number>>(new Map())

  // 主圖 candlestick series (用於 price <-> coordinate)
  // ✅✅✅ 修正點：改成 any，避免 TS 推論成 never
  const primarySeriesRef = useRef<any>(null)

  // ✅ 主圖 K 線資料（用於計算分價圖）
  const primaryCandleDataRef = useRef<any[]>([])
  // ✅ 成交量 Map（key=round(normalized_ts) value=volume）
  const volumeByTimeRef = useRef<Map<number, number>>(new Map())
  // ✅ 分價圖開關
  const vpEnabledRef = useRef<boolean>(false)

  // 畫線工具狀態
  const drawModeRef = useRef<DrawMode>("mouse")
  const drawColorRef = useRef<string>("#ffffff")
  const drawWidthRef = useRef<number>(2)

  const drawToolbarRef = useRef<HTMLDivElement | null>(null)
  const drawLayerRef = useRef<SVGSVGElement | null>(null)
  const drawingsRef = useRef<Drawing[]>([])
  const pendingPointRef = useRef<PendingPoint | null>(null)
  const previewRef = useRef<Drawing | null>(null)

  // 拖曳狀態（只在滑鼠模式生效）
  const dragRef = useRef<DragState | null>(null)

  const chartElRefs = useMemo(() => {
    return Array(chartsData.length)
      .fill(null)
      .map(() => React.createRef<HTMLDivElement>())
  }, [chartsData.length])

  // 監聽 highlightRange 變化字串，確保 Python 端改變時觸發更新
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

  const clampIndex = (i: number) => {
    const n = primaryTimesRawRef.current.length
    if (n <= 0) return 0
    return Math.max(0, Math.min(n - 1, i))
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

    // =========================================================
    // ✅ 分價圖（Volume Profile）：疊在主圖上（可開關）
    // =========================================================
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
                // ✅ 修正：分價圖柱狀更長、更明顯
                const maxBarW = Math.min(420, w * 0.62)
                const xRight = w - 6

                // ✅ 最大量 / 第二大量：找 top2
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
                    fill = "rgba(244, 67, 54, 0.22)" // ✅ 最大量：紅色
                    stroke = "rgba(244, 67, 54, 0.60)"
                  } else if (b === secondIdx) {
                    fill = "rgba(255, 152, 0, 0.22)" // ✅ 第二大量：橘色
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
      } catch (e) {
        // ignore
      }
    }

    const makeLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      color: string,
      width: number,
      dashed: boolean
    ) => {
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

    const makeCircle = (cx: number, cy: number, color: string, width: number, dashed: boolean) => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle")
      c.setAttribute("cx", String(cx))
      c.setAttribute("cy", String(cy))
      c.setAttribute("r", String(Math.max(3, Math.min(5, width + 1))))
      c.setAttribute("fill", color)
      c.setAttribute("opacity", dashed ? "0.65" : "0.9")
      c.setAttribute("stroke", "rgba(0,0,0,0.35)")
      c.setAttribute("stroke-width", "1")
      return c
    }

    const drawOne = (d: Drawing, dashed: boolean) => {
      const color = d.color
      const width = d.width

      if (d.mode === "hline") {
        const yc = series.priceToCoordinate(d.p1)
        if (yc == null) return
        const y = yc as unknown as number
        if (!Number.isFinite(y)) return
        svg.appendChild(makeLine(0, y, w, y, color, width, dashed))
        svg.appendChild(makeCircle(10, y, color, width, dashed))
        return
      }

      const x1c = ts.timeToCoordinate(d.t1)
      const x2c = ts.timeToCoordinate(d.t2)
      const y1c = series.priceToCoordinate(d.p1)
      const y2c = series.priceToCoordinate(d.p2)

      if (x1c == null || x2c == null || y1c == null || y2c == null) return

      const x1 = x1c as unknown as number
      const x2 = x2c as unknown as number
      const y1 = y1c as unknown as number
      const y2 = y2c as unknown as number

      if (!Number.isFinite(x1) || !Number.isFinite(x2) || !Number.isFinite(y1) || !Number.isFinite(y2)) return

      if (d.mode === "line") {
        svg.appendChild(makeLine(x1, y1, x2, y2, color, width, dashed))
        svg.appendChild(makeCircle(x1, y1, color, width, dashed))
        svg.appendChild(makeCircle(x2, y2, color, width, dashed))
        return
      }

      if (d.mode === "ray") {
        const xRight = w
        const xr = xRight
        let yr: number = y2

        const dx = x2 - x1
        const dy = y2 - y1

        if (Math.abs(dx) < 1e-6) {
          svg.appendChild(makeLine(x1, 0, x1, h, color, width, dashed))
          svg.appendChild(makeCircle(x1, y1, color, width, dashed))
          svg.appendChild(makeCircle(x2, y2, color, width, dashed))
        } else {
          const slope = dy / dx
          yr = y1 + slope * (xr - x1)
          svg.appendChild(makeLine(x1, y1, xr, yr, color, width, dashed))
          svg.appendChild(makeCircle(x1, y1, color, width, dashed))
          svg.appendChild(makeCircle(x2, y2, color, width, dashed))
        }
      }
    }

    // 先畫已完成的實體
    for (const d of drawingsRef.current) {
      drawOne(d, false)
    }

    // 再畫預覽（虛線）
    if (previewRef.current) {
      drawOne(previewRef.current, true)
    }
  }

  // =========================================================
  // 核心邏輯：計算並繪製遮罩
  // =========================================================
  const updateGlobalMask = () => {
    const host = chartsContainerRef.current
    const mask = globalMaskRef.current
    if (!host || !mask) return

    const hr = chartsData?.[0]?.highlightRange
    const times = primaryTimesRef.current // 這裡是已經 normalize 過的 timestamps

    // 1. 檢查資料是否充足
    if (!hr || !hr.start || !hr.end || !times || times.length === 0 || panes.current.length === 0) {
      mask.style.display = "none"
      return
    }

    // 2. 將 Python 傳來的 start/end 轉成 Timestamp
    const tStart = normalizeDate(hr.start)
    const tEnd = normalizeDate(hr.end)

    if (tStart === null || tEnd === null) {
      mask.style.display = "none"
      return
    }

    // 3. 在 times 陣列中尋找對應的 Index
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

      // ✅ 遮罩只覆蓋主圖高度
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

  // =========================================================
  // Backspace 刪除：取消預覽 or 刪最後一筆
  // =========================================================
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Backspace") return

      const t = e.target as HTMLElement | null
      if (t) {
        const tag = (t.tagName || "").toUpperCase()
        if (tag === "INPUT" || tag === "TEXTAREA" || (t as any).isContentEditable) {
          return
        }
      }

      // 先取消預覽（如果正在畫）
      if (pendingPointRef.current) {
        e.preventDefault()
        pendingPointRef.current = null
        previewRef.current = null
        renderDrawings()
        return
      }

      // 刪除最後一筆
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

  // =========================================================
  // 初始化 Chart
  // =========================================================
  useEffect(() => {
    if (!chartsData?.length) return
    if (chartElRefs.some((ref) => !ref.current)) return

    // Cleanup
    chartInstances.current.forEach((c) => c && c.remove())
    chartInstances.current = []
    panes.current = []
    primaryTimesRef.current = []
    primaryTimesRawRef.current = []
    primaryIndexMapRef.current = new Map()
    primarySeriesRef.current = null
    primaryCandleDataRef.current = []
    volumeByTimeRef.current = new Map()

    const host = chartsContainerRef.current
    if (host) {
      globalVLineRef.current = ensureGlobalVLine(host)
      globalMaskRef.current = ensureGlobalMask(host)

      // ✅ Toolbar
      drawToolbarRef.current = ensureDrawToolbar(
        host,
        () => drawModeRef.current,
        (m) => {
          drawModeRef.current = m
          pendingPointRef.current = null
          previewRef.current = null
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

  // =========================================================
  // 建立/更新 Series 與 Data
  // =========================================================
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

    const clickSubscriptions: Array<{ chart: IChartApi; handler: (p: MouseEventParams) => void }> = []
    const crosshairSubscriptions: Array<{ chart: IChartApi; handler: (p: MouseEventParams) => void }> = []

    // 拖曳事件（DOM）
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
          // ✅ 修正：十字線碰到均線/任何線不要有圓點（關閉 crosshair marker）
          if (s.type !== "Candlestick") {
            try {
              ;(api as any).applyOptions({ crosshairMarkerVisible: false })
            } catch (e) {}
          }

          if (s.priceScale) chart.priceScale(s.options?.priceScaleId || "").applyOptions(s.priceScale)

          api.setData(s.data)
          if (s.markers) api.setMarkers(s.markers)

          // ✅ 主圖 K 線資料
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

          // ✅ 成交量來源：第二個 pane 的 Histogram（i===1）
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

    // =========================================================
    // 事件同步邏輯
    // =========================================================

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

    // ✅ 預設只顯示近 60 根 K 棒
    try {
      const c0 = chartInstances.current[0]
      const n = primaryTimesRef.current.length
      if (c0 && n > 0) {
        const from = Math.max(0, n - 60)
        const to = n - 1
        c0.timeScale().setVisibleLogicalRange({ from, to })
      }
    } catch (e) {}

    // ✅ 預覽線更新：主圖 crosshair move 時更新 preview
    try {
      const c0 = chartInstances.current[0]
      if (c0) {
        const handler = (param: MouseEventParams) => {
          if (!param || !param.time || !param.point) return
          if (!pendingPointRef.current) return

          const series = primarySeriesRef.current
          const p0 = panes.current[0]
          if (!series || !p0 || !p0.chart) return

          const pp = pendingPointRef.current
          const modeNow = pp.mode

          // hline：因為改成「點一下就實體」，這裡通常不會進來
          if (modeNow === "hline") {
            previewRef.current = {
              mode: "hline",
              t1: pp.t,
              p1: pp.p,
              t2: pp.t,
              p2: pp.p,
              color: drawColorRef.current,
              width: drawWidthRef.current,
            }
            renderDrawings()
            return
          }

          let price: number | null = null
          try {
            price = series.coordinateToPrice((param.point as any).y) as any
          } catch (e) {
            price = null
          }
          if (price == null || !Number.isFinite(price)) return

          previewRef.current = {
            mode: modeNow === "ray" ? "ray" : "line",
            t1: pp.t,
            p1: pp.p,
            t2: param.time,
            p2: price,
            color: drawColorRef.current,
            width: drawWidthRef.current,
          }
          renderDrawings()
        }

        c0.subscribeCrosshairMove(handler)
        crosshairSubscriptions.push({ chart: c0, handler })
      }
    } catch (e) {}

    // ✅ 點兩下才成形：第一下建立 pending + 預覽，第二下 commit
    // ✅ 但：水平線改成「點一下就直接實體」
    try {
      const c0 = chartInstances.current[0]
      if (c0) {
        const handler = (param: MouseEventParams) => {
          if (drawModeRef.current === "mouse") return
          if (!param || !param.time || !param.point) return

          const series = primarySeriesRef.current
          if (!series) return

          let price: number | null = null
          try {
            price = series.coordinateToPrice((param.point as any).y) as any
          } catch (e) {
            price = null
          }
          if (price == null || !Number.isFinite(price)) return

          const t = param.time
          const mode = drawModeRef.current

          // ✅ 水平線：點一下直接實體
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
            }

            drawingsRef.current.push(newDrawing)
            renderDrawings()
            return
          }

          // 第一次點
          if (!pendingPointRef.current) {
            pendingPointRef.current = { mode, t, p: price }

            previewRef.current = {
              mode: mode === "ray" ? "ray" : "line",
              t1: t,
              p1: price,
              t2: t,
              p2: price,
              color: drawColorRef.current,
              width: drawWidthRef.current,
            }

            renderDrawings()
            return
          }

          // 第二次點：commit
          const p1 = pendingPointRef.current
          pendingPointRef.current = null

          const dMode: DrawingMode = p1.mode === "ray" ? "ray" : "line"

          const newDrawing: Drawing = {
            mode: dMode,
            t1: p1.t,
            p1: p1.p,
            t2: t,
            p2: price,
            color: drawColorRef.current,
            width: drawWidthRef.current,
          }

          drawingsRef.current.push(newDrawing)

          previewRef.current = null
          renderDrawings()
        }

        c0.subscribeClick(handler)
        clickSubscriptions.push({ chart: c0, handler })
      }
    } catch (e) {}

    // =========================================================
    // ✅ 實體線可拖曳移動（只在「滑鼠模式」）
    // =========================================================
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

        const findHit = (mx: number, my: number) => {
          const ts = chart0.timeScale()
          const w = container.clientWidth || 1
          const h = container.clientHeight || 1

          let bestIdx = -1
          let bestDist = Infinity

          for (let i = 0; i < drawingsRef.current.length; i++) {
            const d = drawingsRef.current[i]
            if (d.mode === "hline") {
              const yc = series.priceToCoordinate(d.p1)
              if (yc == null) continue
              const y = yc as unknown as number
              const dd = Math.abs(my - y)
              if (dd < bestDist) {
                bestDist = dd
                bestIdx = i
              }
              continue
            }

            const x1c = ts.timeToCoordinate(d.t1)
            const x2c = ts.timeToCoordinate(d.t2)
            const y1c = series.priceToCoordinate(d.p1)
            const y2c = series.priceToCoordinate(d.p2)
            if (x1c == null || x2c == null || y1c == null || y2c == null) continue

            const x1 = x1c as unknown as number
            const x2 = x2c as unknown as number
            const y1 = y1c as unknown as number
            const y2 = y2c as unknown as number
            if (!Number.isFinite(x1) || !Number.isFinite(x2) || !Number.isFinite(y1) || !Number.isFinite(y2)) continue

            if (d.mode === "line") {
              const dd = distPointToSegment(mx, my, x1, y1, x2, y2)
              if (dd < bestDist) {
                bestDist = dd
                bestIdx = i
              }
              continue
            }

            if (d.mode === "ray") {
              const xr = w
              let yr = y2
              const dx = x2 - x1
              const dy = y2 - y1
              if (Math.abs(dx) < 1e-6) {
                const dd = Math.abs(mx - x1)
                if (dd < bestDist) {
                  bestDist = dd
                  bestIdx = i
                }
              } else {
                const slope = dy / dx
                yr = y1 + slope * (xr - x1)
                const dd = distPointToSegment(mx, my, x1, y1, xr, yr)
                if (dd < bestDist) {
                  bestDist = dd
                  bestIdx = i
                }
              }
              continue
            }
          }

          return { idx: bestIdx, dist: bestDist }
        }

        domMouseDown = (e: MouseEvent) => {
          if (drawModeRef.current !== "mouse") return
          if (!series || !chart0) return
          if (drawingsRef.current.length === 0) return

          const rect = container.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top

          const hit = findHit(mx, my)
          const threshold = 7
          if (hit.idx < 0 || hit.dist > threshold) return

          try {
            e.preventDefault()
            e.stopPropagation()
            ;(e as any).stopImmediatePropagation?.()
          } catch (err) {}

          const ts = chart0.timeScale()
          const logical = ts.coordinateToLogical(mx as any)
          const price = series.coordinateToPrice(my as any) as any
          if (logical == null || price == null || !Number.isFinite(price)) return

          const d = drawingsRef.current[hit.idx]
          const orig: Drawing = { ...d }

          const idx1 = d.mode === "hline" ? -1 : timeToIndex(d.t1)
          const idx2 = d.mode === "hline" ? -1 : timeToIndex(d.t2)

          dragRef.current = {
            idx: hit.idx,
            orig,
            startLogical: Number(logical),
            startPrice: Number(price),
            origIdx1: idx1,
            origIdx2: idx2,
          }

          container.style.cursor = "grabbing"
        }

        domMouseMove = (e: MouseEvent) => {
          if (drawModeRef.current !== "mouse") return
          if (!series || !chart0) return

          const rect = container.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top

          if (!dragRef.current) {
            const hit = findHit(mx, my)
            const threshold = 7
            container.style.cursor = hit.idx >= 0 && hit.dist <= threshold ? "grab" : ""
            return
          }

          try {
            e.preventDefault()
            e.stopPropagation()
            ;(e as any).stopImmediatePropagation?.()
          } catch (err) {}

          const ts = chart0.timeScale()
          const logicalNow = ts.coordinateToLogical(mx as any)
          const priceNow = series.coordinateToPrice(my as any) as any
          if (logicalNow == null || priceNow == null || !Number.isFinite(priceNow)) return

          const st = dragRef.current
          const deltaBars = Math.round(Number(logicalNow) - st.startLogical)
          const deltaPrice = Number(priceNow) - st.startPrice

          const orig = st.orig
          const updated: Drawing = { ...drawingsRef.current[st.idx] }

          if (orig.mode === "hline") {
            updated.p1 = orig.p1 + deltaPrice
            updated.p2 = updated.p1
            drawingsRef.current[st.idx] = updated
            renderDrawings()
            return
          }

          const rawTimes = primaryTimesRawRef.current
          if (!rawTimes || rawTimes.length === 0) return
          if (st.origIdx1 < 0 || st.origIdx2 < 0) return

          const ni1 = clampIndex(st.origIdx1 + deltaBars)
          const ni2 = clampIndex(st.origIdx2 + deltaBars)

          updated.t1 = rawTimes[ni1]
          updated.t2 = rawTimes[ni2]
          updated.p1 = orig.p1 + deltaPrice
          updated.p2 = orig.p2 + deltaPrice

          drawingsRef.current[st.idx] = updated
          renderDrawings()
        }

        domMouseUp = (e: MouseEvent) => {
          if (!dragRef.current) return
          try {
            e.preventDefault()
            e.stopPropagation()
            ;(e as any).stopImmediatePropagation?.()
          } catch (err) {}

          dragRef.current = null
          container.style.cursor = ""
        }

        container.addEventListener("mousedown", domMouseDown, true)
        window.addEventListener("mousemove", domMouseMove, true)
        window.addEventListener("mouseup", domMouseUp, true)
      }
    } catch (e) {}

    // 初始化遮罩 / 畫線 overlay
    setTimeout(updateGlobalMask, 100)
    setTimeout(renderDrawings, 120)

    // Resize Observer
    const ro = new ResizeObserver(() => {
      panes.current.forEach((p, idx) => {
        try {
          if (p.chart) p.chart.resize(p.container.clientWidth, idx === 0 ? 360 : 160)
        } catch (e) {}
      })
      updateGlobalMask()
      renderDrawings()
    })
    if (chartsContainerRef.current) ro.observe(chartsContainerRef.current)

    // =========================================================
    // Cleanup
    // =========================================================
    return () => {
      ro.disconnect()

      clickSubscriptions.forEach(({ chart, handler }) => {
        try {
          ;(chart as any).unsubscribeClick(handler)
        } catch (e) {}
      })

      crosshairSubscriptions.forEach(({ chart, handler }) => {
        try {
          ;(chart as any).unsubscribeCrosshairMove(handler)
        } catch (e) {}
      })

      // ✅ 拖曳事件移除
      try {
        const p0 = panes.current[0]
        if (p0 && p0.container && domMouseDown) {
          p0.container.removeEventListener("mousedown", domMouseDown, true)
        }
        if (domMouseMove) window.removeEventListener("mousemove", domMouseMove, true)
        if (domMouseUp) window.removeEventListener("mouseup", domMouseUp, true)
      } catch (e) {}

      panes.current = []

      const oldCharts = [...chartInstances.current]
      chartInstances.current = []

      oldCharts.forEach((c) => {
        if (c) {
          try {
            c.remove()
          } catch (e) {}
        }
      })
    }
  }, [chartsData])

  // 額外 Effect: 當 highlightRange 改變時，強制更新 Mask
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

// Helper for tooltip content generation (Keep logic same as before)
const updatePaneTooltip = (pane: PaneMeta, timeStr: string, logical: number) => {
  // ✅ 修正：十字查價資訊改成中文
  let html = `<div style="font-weight:bold;margin-bottom:4px;">日期：${timeStr}</div>`
  pane.series.forEach((s) => {
    try {
      const data = s.api.dataByIndex(logical) as any
      if (!data) return

      let valStr = "--"
      let color = "#fff"
      const opts = s.options as any

      if (data.close !== undefined) {
        // Candlestick
        const isUp = data.close >= data.open
        color = isUp ? opts.upColor : opts.downColor

        // ✅ 新增：顯示該棒漲跌幅（以「前一根收盤價」為基準，若不存在則用開盤價）
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
        const pctStr = `${pct >= 0 ? "+" : ""}${toFixedMaybe(pct, 2)}%`

        valStr = `開:${toFixedMaybe(data.open)} 高:${toFixedMaybe(data.high)} 低:${toFixedMaybe(
          data.low
        )} 收:${toFixedMaybe(data.close)}  漲跌幅:${pctStr}`
      } else if (data.value !== undefined) {
        // Line / Histogram
        // ✅ 修正：均線(如 MA5) 只顯示數字，不要「數值:」
        const title = (s.title || "").trim()
        const isMA = /^MA\d+/i.test(title)
        valStr = isMA ? toFixedMaybe(data.value) : `數值:${toFixedMaybe(data.value)}`
        if (data.color) color = data.color
        else if (opts.color) color = opts.color
        else if (opts.lineColor) color = opts.lineColor
      }

      html += `<div style="display:flex;justify-content:space-between;gap:10px;color:${color}">
                <span>${s.title}</span>
                <span style="font-family:monospace">${valStr}</span>
            </div>`
    } catch (e) {}
  })
  pane.tooltip.innerHTML = html
  pane.tooltip.style.display = "block"
}

export default LightweightChartsMultiplePanes
