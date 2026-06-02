"""Development launcher — equivalent to running `pystream --dev`.

For production use, install the package and run the `pystream` command:
    pip install .
    pystream
"""

from app.cli import main

if __name__ == "__main__":
    import sys
    # Inject --dev so uvicorn watches for file changes during development
    if "--dev" not in sys.argv:
        sys.argv.append("--dev")
    main()
