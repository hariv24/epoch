"""A small QR code encoder (byte mode, versions 1-6, error correction L or M).

No third-party package is needed: the pairing QR is a short URL, which fits version 4-6. Based on the
standard algorithm (ISO/IEC 18004): Reed-Solomon over GF(256), eight mask patterns scored by the four
penalty rules, format information protected by a BCH code.

    matrix = encode("http://192.168.1.23:8765/pair?t=abc")      # list of rows of bools
    svg = to_svg(matrix)
"""
from __future__ import annotations

MAX_VERSION = 6

# Index = version. Only versions 1..6 are needed.
_ECC_PER_BLOCK = {"L": (-1, 7, 10, 15, 20, 26, 18), "M": (-1, 10, 16, 26, 18, 24, 16)}
_NUM_BLOCKS = {"L": (-1, 1, 1, 1, 1, 1, 2), "M": (-1, 1, 1, 1, 2, 2, 4)}
_FORMAT_BITS = {"L": 1, "M": 0}  # the two-bit ECC indicator in the format information
_ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34]}


def _gf_mul(x: int, y: int) -> int:
    z = 0
    for i in range(7, -1, -1):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z


def _rs_divisor(degree: int) -> list[int]:
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _gf_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _gf_mul(root, 0x02)
    return result


def _rs_remainder(data: list[int], divisor: list[int]) -> list[int]:
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= _gf_mul(coef, factor)
    return result


def _raw_data_modules(version: int) -> int:
    result = (16 * version + 128) * version + 64
    if version >= 2:
        num_align = version // 7 + 2
        result -= (25 * num_align - 10) * num_align - 55
    return result


def _data_codewords(version: int, ecc: str) -> int:
    return _raw_data_modules(version) // 8 - _ECC_PER_BLOCK[ecc][version] * _NUM_BLOCKS[ecc][version]


def capacity_bytes(version: int, ecc: str = "M") -> int:
    """How many bytes of text a version holds in byte mode."""
    return (_data_codewords(version, ecc) * 8 - 12) // 8


def _bit(value: int, i: int) -> bool:
    return ((value >> i) & 1) != 0


class _Matrix:
    def __init__(self, version: int) -> None:
        self.size = version * 4 + 17
        self.version = version
        self.mod = [[False] * self.size for _ in range(self.size)]
        self.fn = [[False] * self.size for _ in range(self.size)]

    def set_fn(self, x: int, y: int, dark: bool) -> None:
        self.mod[y][x] = dark
        self.fn[y][x] = True

    def draw_function_patterns(self, ecc: str) -> None:
        size = self.size
        for i in range(size):
            self.set_fn(6, i, i % 2 == 0)
            self.set_fn(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (size - 4, 3), (3, size - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    xx, yy = cx + dx, cy + dy
                    if 0 <= xx < size and 0 <= yy < size:
                        self.set_fn(xx, yy, max(abs(dx), abs(dy)) not in (2, 4))
        pos = _ALIGN[self.version]
        for i, cx in enumerate(pos):
            for j, cy in enumerate(pos):
                if (i == 0 and j == 0) or (i == 0 and j == len(pos) - 1) or (i == len(pos) - 1 and j == 0):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self.set_fn(cx + dx, cy + dy, max(abs(dx), abs(dy)) != 1)
        self.draw_format(ecc, 0)

    def draw_format(self, ecc: str, mask: int) -> None:
        data = _FORMAT_BITS[ecc] << 3 | mask
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = (data << 10 | rem) ^ 0x5412
        size = self.size
        for i in range(0, 6):
            self.set_fn(8, i, _bit(bits, i))
        self.set_fn(8, 7, _bit(bits, 6))
        self.set_fn(8, 8, _bit(bits, 7))
        self.set_fn(7, 8, _bit(bits, 8))
        for i in range(9, 15):
            self.set_fn(14 - i, 8, _bit(bits, i))
        for i in range(0, 8):
            self.set_fn(size - 1 - i, 8, _bit(bits, i))
        for i in range(8, 15):
            self.set_fn(8, size - 15 + i, _bit(bits, i))
        self.set_fn(8, size - 8, True)

    def draw_codewords(self, data: list[int]) -> None:
        size = self.size
        i = 0
        right = size - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vert in range(size):
                for j in range(2):
                    x = right - j
                    upward = ((right + 1) & 2) == 0
                    y = (size - 1 - vert) if upward else vert
                    if not self.fn[y][x] and i < len(data) * 8:
                        self.mod[y][x] = _bit(data[i >> 3], 7 - (i & 7))
                        i += 1
            right -= 2

    def apply_mask(self, mask: int) -> None:
        for y in range(self.size):
            for x in range(self.size):
                if mask == 0:
                    invert = (x + y) % 2 == 0
                elif mask == 1:
                    invert = y % 2 == 0
                elif mask == 2:
                    invert = x % 3 == 0
                elif mask == 3:
                    invert = (x + y) % 3 == 0
                elif mask == 4:
                    invert = (x // 3 + y // 2) % 2 == 0
                elif mask == 5:
                    invert = x * y % 2 + x * y % 3 == 0
                elif mask == 6:
                    invert = (x * y % 2 + x * y % 3) % 2 == 0
                else:
                    invert = ((x + y) % 2 + x * y % 3) % 2 == 0
                if invert and not self.fn[y][x]:
                    self.mod[y][x] = not self.mod[y][x]

    def penalty(self) -> int:
        size, mod = self.size, self.mod
        score = 0
        for lines in (mod, [list(col) for col in zip(*mod)]):
            for line in lines:
                run = 1
                for k in range(1, size):
                    if line[k] == line[k - 1]:
                        run += 1
                    else:
                        if run >= 5:
                            score += run - 2
                        run = 1
                if run >= 5:
                    score += run - 2
                text = "".join("1" if v else "0" for v in line)
                score += 40 * (text.count("10111010000") + text.count("00001011101"))
        for y in range(size - 1):
            for x in range(size - 1):
                if mod[y][x] == mod[y][x + 1] == mod[y + 1][x] == mod[y + 1][x + 1]:
                    score += 3
        dark = sum(v for row in mod for v in row)
        total = size * size
        score += 10 * (-(-abs(dark * 20 - total * 10) // total) - 1)
        return score


def _add_ecc_and_interleave(data: list[int], version: int, ecc: str) -> list[int]:
    num_blocks = _NUM_BLOCKS[ecc][version]
    block_ecc = _ECC_PER_BLOCK[ecc][version]
    raw = _raw_data_modules(version) // 8
    num_short = num_blocks - raw % num_blocks
    short_len = raw // num_blocks
    divisor = _rs_divisor(block_ecc)
    blocks: list[list[int]] = []
    k = 0
    for i in range(num_blocks):
        chunk = data[k:k + short_len - block_ecc + (0 if i < num_short else 1)]
        k += len(chunk)
        parity = _rs_remainder(chunk, divisor)
        if i < num_short:
            chunk = chunk + [0]  # a dummy so that all blocks are the same length; skipped below
        blocks.append(chunk + parity)
    result: list[int] = []
    for i in range(len(blocks[0])):
        for j, block in enumerate(blocks):
            if i != short_len - block_ecc or j >= num_short:
                result.append(block[i])
    return result


def encode(text: str, ecc: str = "M") -> list[list[bool]]:
    """The QR matrix (True = dark module) for `text`. Raises ValueError when it does not fit version 6."""
    if ecc not in _FORMAT_BITS:
        raise ValueError("ecc must be 'L' or 'M'")
    payload = text.encode("utf-8")
    version = next((v for v in range(1, MAX_VERSION + 1) if len(payload) <= capacity_bytes(v, ecc)), None)
    if version is None:
        raise ValueError(f"text is too long for a small QR code ({len(payload)} bytes)")
    capacity_bits = _data_codewords(version, ecc) * 8
    bits: list[int] = []

    def put(value: int, length: int) -> None:
        bits.extend((value >> i) & 1 for i in range(length - 1, -1, -1))

    put(0b0100, 4)
    put(len(payload), 8)
    for b in payload:
        put(b, 8)
    put(0, min(4, capacity_bits - len(bits)))
    while len(bits) % 8:
        bits.append(0)
    data = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    pad = 0xEC
    while len(data) < capacity_bits // 8:
        data.append(pad)
        pad ^= 0xEC ^ 0x11
    codewords = _add_ecc_and_interleave(data, version, ecc)

    best: tuple[int, int, _Matrix] | None = None
    for mask in range(8):
        m = _Matrix(version)
        m.draw_function_patterns(ecc)
        m.draw_codewords(codewords)
        m.apply_mask(mask)
        m.draw_format(ecc, mask)
        score = m.penalty()
        if best is None or score < best[0]:
            best = (score, mask, m)
    assert best is not None
    return [row[:] for row in best[2].mod]


def to_rows(matrix: list[list[bool]]) -> list[str]:
    """The matrix as strings of 0/1, one per row."""
    return ["".join("1" if v else "0" for v in row) for row in matrix]


def to_svg(matrix: list[list[bool]], border: int = 4, color: str = "currentColor") -> str:
    """A self-contained SVG (one path, no background; the quiet zone is included)."""
    size = len(matrix) + border * 2
    parts = []
    for y, row in enumerate(matrix):
        x = 0
        while x < len(row):
            if row[x]:
                start = x
                while x < len(row) and row[x]:
                    x += 1
                parts.append(f"M{start + border},{y + border}h{x - start}v1h-{x - start}z")
            else:
                x += 1
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges" '
        f'role="img" aria-label="QR code"><path fill="{color}" d="{"".join(parts)}"/></svg>'
    )
