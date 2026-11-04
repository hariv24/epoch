"""Compatibility shim: `python -m underdog` starts Epoch."""
from epoch.main import run

if __name__ == "__main__":
    print("Underdog is now called Epoch. Use `python -m epoch` from now on.", flush=True)
    run()
