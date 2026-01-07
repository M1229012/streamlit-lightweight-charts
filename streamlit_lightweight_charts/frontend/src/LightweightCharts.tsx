import { useRenderData } from "streamlit-component-lib-react-hooks"
import {
  createChart,
  IChartApi,
  MouseEventParams,
  ISeriesApi,
} from "lightweight-charts"
import React, { useRef, useEffect } from "react"

const LightweightChartsMultiplePanes: React.VFC = () => {

  // 接收 Python 傳來的數據
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"]

  const chartsContainerRef = useRef<HTMLDivElement>(null)
  
  // 建立圖表參考
  const chartElRefs = useRef<Array<React.RefObject<HTMLDivElement>>>(
      Array(chartsData.length).fill(null).map(() => React.createRef<HTMLDivElement>())
  ).current;

  // 儲存所有圖表實例
  const chartInstances = useRef<(IChartApi | null)[]>([]);

  useEffect(() => {
      // 基本檢查
      if (chartElRefs.some((ref) => !ref.current)) return;

      // 清理舊圖表
      chartInstances.current.forEach(chart => {
          if (chart) chart.remove();
      });
      chartInstances.current = [];

      // 同步鎖，防止無窮迴圈
      let isCrosshairSyncing = false;

      chartElRefs.forEach((ref, i) => {
        const container = ref.current;
        if (!container) return;

        // 1. 建立圖表
        const chart = createChart(
          container, {
            height: 300,
            width: container.clientWidth || 600,
            ...chartsData[i].chart,
            // 強制設定圖表背景為透明或深色
            layout: { 
                background: { type: 'solid', color: 'transparent' }, 
                textColor: '#d1d4dc',
                ...chartsData[i].chart.layout 
            }
          }
        );
        chartInstances.current[i] = chart;

        // ---------------------------------------------------------
        // 🎨 浮動 Tooltip (深色風格)
        // ---------------------------------------------------------
        let toolTip = container.querySelector('.floating-tooltip') as HTMLDivElement;
        if (!toolTip) {
            toolTip = document.createElement('div');
            toolTip.className = 'floating-tooltip';
            Object.assign(toolTip.style, {
                width: 'auto',
                height: 'auto',
                position: 'absolute',
                display: 'none',
                padding: '8px',
                boxSizing: 'border-box',
                fontSize: '12px',
                textAlign: 'left',
                zIndex: '1000',
                top: '12px',
                left: '12px',
                pointerEvents: 'none',
                border: '1px solid #444',
                borderRadius: '4px',
                fontFamily: 'sans-serif',
                background: 'rgba(20, 20, 20, 0.9)',
                color: '#ececec',
                boxShadow: '0 2px 5px rgba(0,0,0,0.5)'
            });
            container.style.position = 'relative';
            container.appendChild(toolTip);
        }

        // 2. 加入 Series 數據
        for (const series of chartsData[i].series){
          let chartSeries;
          switch(series.type) {
            case 'Area': chartSeries = chart.addAreaSeries(series.options); break;
            case 'Bar': chartSeries = chart.addBarSeries(series.options); break;
            case 'Baseline': chartSeries = chart.addBaselineSeries(series.options); break;
            case 'Candlestick': chartSeries = chart.addCandlestickSeries(series.options); break;
            case 'Histogram': chartSeries = chart.addHistogramSeries(series.options); break;
            case 'Line': chartSeries = chart.addLineSeries(series.options); break;
            default: continue;
          }

          if (chartSeries) {
              if(series.priceScale) chart.priceScale(series.options.priceScaleId || '').applyOptions(series.priceScale);
              chartSeries.setData(series.data);
              if(series.markers) chartSeries.setMarkers(series.markers);
          }
        }

        // ---------------------------------------------------------
        // 🔗 核心功能：十字線同步 與 Tooltip 邏輯修正
        // ---------------------------------------------------------
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            
            // --- A. Tooltip 顯示邏輯 ---
            if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
                toolTip.style.display = 'none';
            } else {
                toolTip.style.display = 'block';
                const dateStr = param.time.toString();
                let tooltipHtml = `<div style="font-weight: bold; margin-bottom: 5px; border-bottom: 1px solid #555; padding-bottom: 3px; color: #fff;">${dateStr}</div>`;
                
                param.seriesData.forEach((value: any, series: ISeriesApi<any>) => {
                    const seriesOptions = series.options() as any;
                    const title = seriesOptions.title || ''; 

                    // 🛠️ 修正 1：如果沒有標題 (如 RSI 的基準線)，直接跳過不顯示
                    // 只針對單一數值類型 (K線圖通常都有開高低收所以不跳過)
                    if (value.value !== undefined && !title) {
                        return;
                    }

                    // 抓取顏色
                    let color = 'white';
                    if (seriesOptions.color) color = seriesOptions.color;
                    else if (seriesOptions.upColor) color = seriesOptions.upColor;
                    else if (seriesOptions.lineColor) color = seriesOptions.lineColor;

                    // 1. K線數據 (Open, High, Low, Close)
                    if (value.open !== undefined) {
                        const candleColor = value.close >= value.open ? '#ef5350' : '#26a69a';
                        tooltipHtml += `
                            <div style="margin-top: 4px;">
                                <div style="display:flex; align-items:center;">
                                    <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${candleColor}; margin-right: 6px;"></span>
                                    <span style="font-weight: bold; color: ${candleColor};">收盤: ${value.close.toFixed(2)}</span>
                                </div>
                                <div style="font-size: 11px; color: #aaa; margin-left: 14px;">
                                    <span>開:${value.open.toFixed(2)} 高:${value.high.toFixed(2)} 低:${value.low.toFixed(2)}</span>
                                </div>
                            </div>`;
                    } 
                    // 2. 單一數值 (成交量、KD、MACD、大戶散戶)
                    else if (value.value !== undefined) {
                        const valColor = seriesOptions.color || (value.value >= 0 ? '#ef5350' : '#26a69a');
                        
                        let displayValue = "";
                        
                        // 🛠️ 修正 2：優先判斷百分比 (大戶/散戶持股)
                        if (title.includes('%')) {
                            displayValue = Number(value.value).toFixed(2) + '%';
                        }
                        // 判斷是否為張數 (成交量、外資買賣超)
                        else if (title.includes('量') || title.includes('Vol') || title.includes('資') || title.includes('信') || title.includes('營') || title.includes('戶')) {
                            displayValue = Math.round(value.value).toLocaleString() + ' 張';
                        } 
                        // 其他一般指標 (如 KD, MACD)
                        else {
                            displayValue = Number(value.value).toFixed(2);
                        }

                        tooltipHtml += `
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                                <div style="display: flex; align-items: center;">
                                    <span style="width: 6px; height: 6px; border-radius: 50%; background-color: ${valColor}; margin-right: 6px;"></span>
                                    <span style="color: #ddd; margin-right: 8px;">${title}</span>
                                </div>
                                <span style="font-family: monospace; font-weight: bold; color: ${valColor};">
                                    ${displayValue}
                                </span>
                            </div>`;
                    }
                });

                toolTip.innerHTML = tooltipHtml;
                
                // 計算位置
                const boxW = 180;
                const boxH = 100;
                const margin = 15;
                let left = param.point.x + margin;
                let top = param.point.y + margin;
                
                if (left > (container.clientWidth - boxW)) left = param.point.x - margin - boxW;
                if (top > (container.clientHeight - boxH)) top = param.point.y - boxH - margin;
                
                toolTip.style.left = left + 'px';
                toolTip.style.top = top + 'px';
            }

            // --- B. 同步貫穿邏輯 ---
            if (!isCrosshairSyncing) {
                isCrosshairSyncing = true;
                chartInstances.current.forEach((c) => {
                    if (c && c !== chart) {
                        if (param.point && param.point.x >= 0 && param.point.y >= 0) {
                            (c as any).moveCrosshair(param.point);
                        } else {
                            (c as any).clearCrosshairPosition();
                        }
                    }
                });
                isCrosshairSyncing = false;
            }
        });

        // 3. 自動縮放
        chart.timeScale().fitContent();
      });
  
      // 4. 同步時間軸
      const validCharts = chartInstances.current.filter((c): c is IChartApi => c !== null);
      if(chartsData.length > 1){
        validCharts.forEach((chart) => {
          chart.timeScale().subscribeVisibleTimeRangeChange(() => {
            validCharts.filter(c => c !== chart).forEach(c => {
                c.timeScale().applyOptions({ rightOffset: chart.timeScale().scrollPosition() });
            });
          });
          chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (range) {
              validCharts.filter(c => c !== chart).forEach(c => {
                  c.timeScale().setVisibleLogicalRange(range);
              });
            }
          });
      });}

      return () => { 
        chartInstances.current.forEach(chart => chart && chart.remove());
        chartInstances.current = [];
      }
    }, [chartsData]);

    return (
      <div ref={chartsContainerRef}>
        {chartElRefs.map((ref, i) => (
          <div ref={ref} id={`chart-${i}`} key={i} />
        ))}
      </div>
    )
}

export default LightweightChartsMultiplePanes;