import setuptools

with open("README.md", "r") as fh:
    long_description = fh.read()

setuptools.setup(
    name="streamlit-lightweight-charts",
    version="0.7.28",  # 🔺 再次升級版本
    author="M1229012",
    author_email="joe.rosa@itpmngt.co.uk",
    license="MIT",
    classifiers=[
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.6",
    ],
    description="Wrapper for TradingView lightweight-charts",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/M1229012/streamlit-lightweight-charts",
    packages=['streamlit_lightweight_charts'],
    package_data={
        'streamlit_lightweight_charts': [
            'frontend/build/*',           # 包含 index.html, asset-manifest.json
            'frontend/build/static/js/*'  # 包含 main.js
            # ❌ 刪除 CSS 那一行，因為它不存在
        ],
    },
    include_package_data=False, # 強制使用上面的設定
    python_requires=">=3.6",
    install_requires=[
        "streamlit >= 0.62",
    ],
)