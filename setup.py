from setuptools import setup, find_packages
from pathlib import Path

here = Path(__file__).parent
readme = here / "README.md"
long_description = readme.read_text(encoding="utf-8") if readme.exists() else ""

setup(
    name="streamlit-lightweight-charts",
    version="0.7.40",
    author="M1229012",
    author_email="joe.rosa@itpmngt.co.uk",
    license="MIT",
    description="Wrapper for TradingView `lightweight-charts`",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/M1229012/streamlit-lightweight-charts",
    packages=find_packages(),
    include_package_data=True,
    python_requires=">=3.8",
    install_requires=["streamlit>=0.62"],
)
