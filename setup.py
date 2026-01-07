import setuptools

with open("README.md", "r") as fh:
    long_description = fh.read()

setuptools.setup(
    name="streamlit-lightweight-charts",
    version="0.7.25",  # ⬆️ 再次升級版本號，確保雲端更新
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
            'frontend/build/*',
            'frontend/build/static/js/*',
            'frontend/build/static/css/*'
        ],
    },
    include_package_data=False,  # 🚨 關鍵！改成 False，強制它讀上面的路徑
    python_requires=">=3.6",
    install_requires=[
        "streamlit >= 0.62",
    ],
)