"""CLI entry point — installed as the `classtream` command."""

import argparse
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="classtream",
        description="Classtream — live classroom screen sharing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  classtream                        # start on 0.0.0.0:8000
  classtream --port 9000            # different port
  classtream --host 127.0.0.1       # localhost only
  classtream --data-dir D:/mydata   # custom data directory
  classtream --dev                  # enable auto-reload (development)
        """,
    )

    parser.add_argument(
        "--host", default="0.0.0.0",
        help="IP address to bind (default: 0.0.0.0 = all interfaces)",
    )
    parser.add_argument(
        "--port", "-p", type=int, default=8000,
        help="Port to listen on (default: 8000)",
    )
    parser.add_argument(
        "--data-dir", metavar="PATH",
        help="Directory for database and uploads (default: ~/.classtream)",
    )
    parser.add_argument(
        "--dev", action="store_true",
        help="Enable auto-reload on code changes (development mode)",
    )
    parser.add_argument(
        "--version", "-v", action="store_true",
        help="Show version and exit",
    )

    args = parser.parse_args()

    if args.version:
        from app import __version__
        print(f"Classtream {__version__}")
        sys.exit(0)

    # Set data directory before any app modules are imported
    if args.data_dir:
        os.environ["CLASSTREAM_DATA"] = os.path.abspath(args.data_dir)

    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.dev,
    )


if __name__ == "__main__":
    main()
