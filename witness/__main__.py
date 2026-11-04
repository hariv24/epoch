"""Compatibility shim: `python -m witness` starts Epoch."""
from epoch.main import run

if __name__ == "__main__":
    print("Witness is now called Epoch. Use `python -m epoch` from now on.", flush=True)
    run()
