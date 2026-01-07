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

  const chartInstances = useRef<(IChartApi | null)[]>([]);

  useEffect(() => {
      // 基本檢查
      if (chartElRefs.some((ref) => !ref.current)) return;

      // 清理舊圖表
      chartInstances.current.forEach(chart => {
          if (chart) chart.remove();
      });
      chartInstances.current = [];

      chartElRefs.forEach((ref, i) => {
        const container = ref.current;
        if (!container) return;

        // 1. 建立圖表
        const chart = createChart(
          container, {
            height: 300,
            width: container.clientWidth || 600,
            ...chartsData[i].chart,
            // 強制設定圖表背景為透明或深色，以防萬一
            layout: { 
                background: { type: 'solid', color: 'transparent' }, 
                textColor: '#d1d4dc',
                ...chartsData[i].chart.layout 
            }
          }
        );
        chartInstances.current[i] = chart;

        // ---------------------------------------------------------
        // 🗑️ 已刪除：原本的左上角三行 Legend 程式碼
        // ---------------------------------------------------------

        // ---------------------------------------------------------
        // 🎨 修改功能：浮動 Tooltip (改成深色風格)
        // ---------------------------------------------------------
        let toolTip = container.querySelector('.floating-tooltip') as HTMLDivElement;
        if (!toolTip) {
            toolTip = document.createElement('div');
            toolTip.className = 'floating-tooltip';
            // 🔥 設定為深色背景樣式
            Object.assign(toolTip.style, {
                width: 'auto',       // 寬度自動
                height: 'auto',      // 高度自動
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
                border: '1px solid #444',            // 深灰色邊框
                borderRadius: '4px',
                fontFamily: 'sans-serif',
                background: 'rgba(20, 20, 20, 0.9)', // 🔥 深色半透明背景
                color: '#ececec',                    // 🔥 淺灰色/白色文字
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
        // 📊 修改功能：滑鼠監聽 (顯示所有副圖數值)
        // ---------------------------------------------------------
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
                toolTip.style.display = 'none';
                return;
            }
            
            toolTip.style.display = 'block';
            
            // 處理日期顯示
            const dateStr = param.time.toString(); // 根據傳入格式顯示日期
            
            // 準備內容 HTML
            let tooltipHtml = `<div style="font-weight: bold; margin-bottom: 5px; border-bottom: 1px solid #555; padding-bottom: 3px; color: #fff;">${dateStr}</div>`;
            
            // 🔥 遍歷所有數據 (K線、成交量、KD、MACD 等都會在這裡)
            param.seriesData.forEach((value: any, series: ISeriesApi<any>) => {
                // 取得該線圖的設定 (嘗試抓取 title 和 顏色)
                const seriesOptions = series.options() as any;
                const title = seriesOptions.title || ''; // 如果 Python 有傳 title，這裡就會顯示 (如 "Vol", "MA20")
                
                // 嘗試抓取顏色 (不同圖表類型的顏色屬性不同)
                let color = 'white';
                if (seriesOptions.color) color = seriesOptions.color;
                else if (seriesOptions.upColor) color = seriesOptions.upColor; // K線或Histogram
                else if (seriesOptions.lineColor) color = seriesOptions.lineColor;

                // 組合顯示內容
                // 1. K線數據 (Open, High, Low, Close)
                if (value.open !== undefined) {
                    const candleColor = value.close >= value.open ? '#ef5350' : '#26a69a'; // 漲跌色
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
                // 2. 單一數值 (成交量、KD、MACD、買賣超)
                else if (value.value !== undefined) {
                    // 根據數值正負決定顏色 (如果是 Histogram 且沒指定顏色的話)
                    const valColor = seriesOptions.color || (value.value >= 0 ? '#ef5350' : '#26a69a');
                    
                    tooltipHtml += `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                            <div style="display: flex; align-items: center;">
                                <span style="width: 6px; height: 6px; border-radius: 50%; background-color: ${valColor}; margin-right: 6px;"></span>
                                <span style="color: #ddd; margin-right: 8px;">${title}</span>
                            </div>
                            <span style="font-family: monospace; font-weight: bold; color: ${valColor};">
                                ${Number(value.value).toFixed(2)}
                            </span>
                        </div>`;
                }
            });

            toolTip.innerHTML = tooltipHtml;
            
            // 計算位置 (防止超出邊界)
            const boxW = 160; // 稍微寬一點以容納文字
            const boxH = 100; // 預估高度
            const margin = 15;
            
            let left = param.point.x + margin;
            let top = param.point.y + margin;
            
            if (left > (container.clientWidth - boxW)) left = param.point.x - margin - boxW;
            if (top > (container.clientHeight - boxH)) top = param.point.y - boxH - margin;
            
            toolTip.style.left = left + 'px';
            toolTip.style.top = top + 'px';
        });

        // 3. 自動縮放
        chart.timeScale().fitContent();
      });
  
      // 4. 同步圖表
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