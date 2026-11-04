"""The pairing QR encoder: round-trip through an independent reader of the matrix."""
from __future__ import annotations

import pytest

from epoch import qr

URL = "http://192.168.100.200:8765/pair?t=abcdefghijklmnopqrstuv"


def read_back(matrix: list[list[bool]]) -> tuple[str, str, int]:
    """Decode a matrix the way a scanner does: format bits, unmask, de-interleave, check Reed-Solomon."""
    size = len(matrix)
    version = (size - 17) // 4
    fmt_positions = [(8, i) for i in range(6)] + [(8, 7), (8, 8), (7, 8)] + [(14 - i, 8) for i in range(9, 15)]
    bits = sum(int(matrix[y][x]) << i for i, (x, y) in enumerate(fmt_positions)) ^ 0x5412
    data5, check = bits >> 10, bits & 0x3FF
    rem = data5
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    assert rem & 0x3FF == check, "format information fails its BCH check"
    ecc = {1: "L", 0: "M"}[data5 >> 3]
    mask = data5 & 7

    shell = qr._Matrix(version)
    shell.draw_function_patterns(ecc)
    grid = [row[:] for row in matrix]
    probe = qr._Matrix(version)
    probe.mod = grid
    probe.fn = shell.fn
    probe.apply_mask(mask)          # masking is its own inverse

    raw = []
    bit_list = []
    right = size - 1
    while right >= 1:
        if right == 6:
            right = 5
        for vert in range(size):
            for j in range(2):
                x = right - j
                upward = ((right + 1) & 2) == 0
                y = (size - 1 - vert) if upward else vert
                if not shell.fn[y][x]:
                    bit_list.append(int(grid[y][x]))
        right -= 2
    for i in range(0, len(bit_list) - len(bit_list) % 8, 8):
        raw.append(int("".join(map(str, bit_list[i:i + 8])), 2))

    num_blocks, block_ecc = qr._NUM_BLOCKS[ecc][version], qr._ECC_PER_BLOCK[ecc][version]
    total = qr._raw_data_modules(version) // 8
    num_short, short_len = num_blocks - total % num_blocks, total // num_blocks
    lengths = [short_len + (0 if i < num_short else 1) for i in range(num_blocks)]
    blocks = [[] for _ in range(num_blocks)]
    pos = 0
    for i in range(max(lengths)):
        for j in range(num_blocks):
            if i < lengths[j] - block_ecc:
                blocks[j].append(raw[pos]); pos += 1
    for i in range(block_ecc):
        for j in range(num_blocks):
            blocks[j].append(raw[pos]); pos += 1
    divisor = qr._rs_divisor(block_ecc)
    data = []
    for block in blocks:
        body, parity = block[:-block_ecc], block[-block_ecc:]
        assert qr._rs_remainder(body, divisor) == parity, "Reed-Solomon check fails"
        data += body
    stream = "".join(f"{b:08b}" for b in data)
    assert stream[:4] == "0100"
    count = int(stream[4:12], 2)
    payload = bytes(int(stream[12 + 8 * i:20 + 8 * i], 2) for i in range(count))
    return payload.decode(), ecc, version


@pytest.mark.parametrize("text", [
    "x", "hello", URL, "http://Harivs-MacBook-Pro.local:8765/pair?t=" + "Z" * 22, "é" * 20, "a" * 100,
])
@pytest.mark.parametrize("ecc", ["M", "L"])
def test_round_trip(text, ecc):
    decoded, got_ecc, version = read_back(qr.encode(text, ecc))
    assert decoded == text and got_ecc == ecc and 1 <= version <= qr.MAX_VERSION


def test_pairing_url_fits_a_small_code():
    assert len(qr.encode(URL)) <= 37          # version 5 or smaller: easy to scan from a laptop screen


def test_too_long_text_is_refused():
    with pytest.raises(ValueError):
        qr.encode("a" * 500)
    with pytest.raises(ValueError):
        qr.encode("a", "H")


def test_finder_patterns_and_timing():
    m = qr.encode(URL)
    n = len(m)
    for ox, oy in ((0, 0), (n - 7, 0), (0, n - 7)):
        assert all(m[oy][ox + i] and m[oy + 6][ox + i] and m[oy + i][ox] and m[oy + i][ox + 6] for i in range(7))
        assert not m[oy + 1][ox + 1] and m[oy + 3][ox + 3]
    assert all(m[6][i] == (i % 2 == 0) for i in range(8, n - 8))


def test_svg_and_rows():
    m = qr.encode(URL)
    svg = qr.to_svg(m)
    assert svg.startswith("<svg") and f'viewBox="0 0 {len(m) + 8} {len(m) + 8}"' in svg and "currentColor" in svg
    rows = qr.to_rows(m)
    assert len(rows) == len(m) and set("".join(rows)) <= {"0", "1"}
