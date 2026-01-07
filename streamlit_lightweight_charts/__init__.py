import os
from enum import Enum
from typing import Dict, Any, Optional

import streamlit as st
import streamlit.components.v1 as components

_COMPONENT_NAME = "streamlit_lightweight_charts"

# ✅ 雲端部署一定要 True（不要改成 False）
_RELEASE = True


class Chart(str, Enum):
    Area = "addAreaSeries"
    Baseline = "addBaselineSeries"
    Histogram = "addHistogramSeries"
    Line = "addLineSeries"
    Bar = "addBarSeries"
    Candlestick = "addCandlestickSeries"


# ✅ 絕對路徑：指到 python package 內的 frontend/build
_PARENT_DIR = os.path.dirname(os.path.abspath(__file__))
_BUILD_DIR = os.path.join(_PARENT_DIR, "frontend", "build")
_INDEX_HTML = os.path.join(_BUILD_DIR, "index.html")


def _debug_component_assets():
    """
    在 Streamlit Cloud 出問題時非常有用：
    你可以在 app 裡呼叫一次，或暫時取消註解下方的自動輸出。
    """
    st.write("📦 streamlit_lightweight_charts package dir:", _PARENT_DIR)
    st.write("📦 component build dir:", _BUILD_DIR)
    st.write("📄 index.html exists:", os.path.exists(_INDEX_HTML))
    if os.path.exists(_BUILD_DIR):
        try:
            st.write("📁 build dir sample:", sorted(os.listdir(_BUILD_DIR))[:20])
        except Exception as e:
            st.write("⚠️ cannot list build dir:", e)


# ✅ 宣告 component
if not _RELEASE:
    # 本地開發用（雲端不能用）
    _component_func = components.declare_component(
        _COMPONENT_NAME,
        url="http://localhost:3001",
    )
else:
    # ✅ 正式用：從 build_dir 讀前端資產
    _component_func = components.declare_component(
        _COMPONENT_NAME,
        path=_BUILD_DIR,
    )


def renderLightweightCharts(charts: Dict[str, Any], key: Optional[str] = None):
    """
    Create a new instance of "renderLightweightCharts".

    Parameters
    ----------
    charts: Dict
        Payload passed to frontend. (你的前端元件會解析 charts 內容)
    key: str or None
        Streamlit key.

    Returns
    -------
    Any
        Component return value (if frontend sends any).
    """

    # ✅ 若雲端資產缺失，直接在 server log / UI 提醒你真正原因
    #    這可以避免你一直卡在「trouble loading…」但不知道缺什麼檔案
    if _RELEASE and (not os.path.exists(_INDEX_HTML)):
        # 你可以把這行改成 st.error(...)，但我用 exception 會更明確讓你看到路徑
        raise FileNotFoundError(
            "Component frontend assets missing. "
            f"Expected index.html at: {_INDEX_HTML}. "
            "This usually means frontend/build was not included in the installed package "
            "(MANIFEST.in / setup.py include_package_data)."
        )

    return _component_func(
        charts=charts,
        key=key,
    )


# =========================
# 開發測試區（雲端不會跑）
# =========================
if not _RELEASE:
    import dataSamples as data

    chartOptions = {
        "width": 600,
        "layout": {"textColor": "black", "background": {"type": "solid", "color": "white"}},
    }

    seriesAreaChart = [{"type": "Area", "data": data.seriesSingleValueData, "options": {}}]
    st.subheader("Area Chart")
    renderLightweightCharts([{"chart": chartOptions, "series": seriesAreaChart}], "area")
    st.markdown("---")
