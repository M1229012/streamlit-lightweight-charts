import setuptools

with open("README.md", "r") as fh:
    long_description = fh.read()

setuptools.setup(
    name="streamlit-lightweight-charts",
    version="0.7.27",  # 🔺 修改1: 升級版本號 (強迫雲端重新下載)
    author="M1229012", # 🔺 修改2: 改成你的名字
    author_email="joe.rosa@itpmngt.co.uk",
    license="MIT",
    classifiers=[
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.6",
    ],
    description="Wrapper for TradingView `lightweight-charts`",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/M1229012/streamlit-lightweight-charts", # 🔺 修改3: 改成你的 GitHub 連結
    packages=['streamlit_lightweight_charts'],
    package_data={
        'streamlit_lightweight_charts': [
            'frontend/build/*', 
            'frontend/build/static/js/*',
            'frontend/build/static/css/*' # 🔺 修改4: 補上 css 路徑 (避免樣式遺失)
        ],
    },
    include_package_data=False, # 🔺 關鍵修改: 改為 False (強制它讀取上面的 package_data，不再依賴 MANIFEST.in)
    python_requires=">=3.6",
    install_requires=[
        "streamlit >= 0.62",
    ],
)