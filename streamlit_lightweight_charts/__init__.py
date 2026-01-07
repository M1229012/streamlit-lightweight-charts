import os
from typing import Dict
from enum import Enum

import streamlit.components.v1 as components

_COMPONENT_NAME = "streamlit_lightweight_charts"
_RELEASE = True  # ✅ Streamlit Cloud 一定要 True（不要改 False）


class Chart(str, Enum):
    Area = 'addAreaSeries'
    Baseline = 'addBaselineSeries'
    Histogram = 'addHistogramSeries'
    Line = 'addLineSeries'
    Bar = 'addBarSeries'
    Candlestick = 'addCandlestickSeries'


# ✅ 一律用「安裝後的套件路徑」去找 frontend/build
parent_dir = os.path.dirname(os.path.abspath(__file__))
build_dir = os.path.join(parent_dir, "frontend", "build")
_INDEX_HTML = os.path.join(build_dir, "index.html")


def debug_component_assets():
    """
    ✅ 用來在 Streamlit Cloud 上定位問題：
    - 你可以在 app 裡 st.write(debug_component_assets()) 看雲端是否真的有 index.html
    """
    return {
        "package_dir": parent_dir,
        "build_dir": build_dir,
        "index_html": _INDEX_HTML,
        "index_exists": os.path.exists(_INDEX_HTML),
        "build_exists": os.path.exists(build_dir),
        "build_listdir_sample": sorted(os.listdir(build_dir))[:30] if os.path.exists(build_dir) else [],
    }


# ✅ 宣告 component：雲端正式部署走 path，開發才走 url
if not _RELEASE:
    _component_func = components.declare_component(
        _COMPONENT_NAME,
        url="http://localhost:3001",
    )
else:
    _component_func = components.declare_component(
        _COMPONENT_NAME,
        path=build_dir
    )


def renderLightweightCharts(charts: Dict, key: str = None):
    """Create a new instance of "renderLightweightCharts".

    Parameters
    ----------
    charts: <List of Dicts>

        chart: <Dict>
        https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ChartOptions

        series: <List of Dicts>
            https://tradingview.github.io/lightweight-charts/docs/series-types

            type: <str-enum>
                Area
                Bar
                Baseline
                Candlestick
                Histogram
                Line

            data: <List of Dicts> accordingly to series type

            options: <Dict> with style options

            priceScale: <Dict> optional

    key: str or None
        An optional key that uniquely identifies this component. If this is None, and the component's
        arguments are changed, the component will be re-mounted in the Streamlit frontend and lose its
        current state.
    """

    # ✅ 關鍵：如果雲端真的缺前端資產，直接把「缺哪個路徑」講清楚（比通用錯誤好查）
    if _RELEASE and (not os.path.exists(_INDEX_HTML)):
        raise FileNotFoundError(
            "streamlit_lightweight_charts frontend assets missing.\n"
            f"Expected: {_INDEX_HTML}\n"
            "Fix:\n"
            "1) Make sure frontend/build is included in the installed package:\n"
            "   - MANIFEST.in: recursive-include streamlit_lightweight_charts/frontend/build *\n"
            "   - setup.py: include_package_data=True\n"
            "2) Make sure Streamlit Cloud is installing YOUR fork/commit (not cached old version).\n"
        )

    return _component_func(
        charts=charts,
        key=key
    )


# ====== 原本的 demo 區（保留）======
if not _RELEASE:
    import streamlit as st
    import dataSamples as data

    chartOptions = {
        "width": 600,
        "layout": {
            "textColor": 'black',
            "background": {"type": 'solid', "color": 'white'}
        }
    }

    # AREA chart
    seriesAreaChart = [{
        "type": 'Area',
        "data": data.seriesSingleValueData,
        "options": {}
    }]
    st.subheader("Area Chart")
    renderLightweightCharts([{
        "chart": chartOptions,
        "series": seriesAreaChart,
    }], 'area')
    st.markdown("---")

    # BASELINE chart
    seriesBaselineChart = [{
        "type": 'Baseline',
        "data": data.seriesBaselineChart,
        "options": {
            "baseValue": {"type": "price", "price": 25},
            "topLineColor": 'rgba( 38, 166, 154, 1)',
            "topFillColor1": 'rgba( 38, 166, 154, 0.28)',
            "topFillColor2": 'rgba( 38, 166, 154, 0.05)',
            "bottomLineColor": 'rgba( 239, 83, 80, 1)',
            "bottomFillColor1": 'rgba( 239, 83, 80, 0.05)',
            "bottomFillColor2": 'rgba( 239, 83, 80, 0.28)'
        }
    }]
    st.subheader("Baseline Chart")
    renderLightweightCharts([{
        "chart": chartOptions,
        "series": seriesBaselineChart
    }], 'baseline')
    st.markdown("---")

    # LINE charts
    seriesLineChart = [{
        "type": 'Line',
        "data": data.seriesSingleValueData,
        "options": {}
    }]
    st.subheader("Line Chart")
    renderLightweightCharts([{
        "chart": chartOptions,
        "series": seriesLineChart
    }], 'line')
    st.markdown("---")

    # HISTOGRAM chart
    seriesHistogramChart = [{
        "type": 'Histogram',
        "data": data.seriesHistogramChart,
        "options": {"color": '#26a69a'}
    }]
    st.subheader("Histogram Chart")
    renderLightweightCharts([{
        "chart": chartOptions,
        "series": seriesHistogramChart
    }], 'histogram')
    st.markdown("---")

    # BAR chart
    seriesBarChart = [{
        "type": 'Bar',
        "data": data.seriesBarChart,
        "options": {
            "upColor": '#26a69a',
            "downColor": '#ef5350'
        }
    }]
    st.subheader("Bar Chart")
    renderLightweightCharts([{
        "chart": chartOptions,
        "series": seriesBarChart
    }], 'bar')
    st.markdown("---")

    # CANDLESTICK chart
    seriesCandlestickChart = [{
        "type": 'Candlestick',
        "data": data.seriesCandlestickChart,
        "options": {
            "upColor": '#26a69a',
            "downColor": '#ef5350',
            "borderVisible": False,
            "wickUpColor": '#26a69a',
            "wickDownColor": '#ef5350'
        }
    }]
    st.subheader("Candlestick Chart")
    renderLightweightCharts([{
        "chart": chartOptions,
        "series": seriesCandlestickChart
    }], 'candlestick')
    st.markdown("---")
