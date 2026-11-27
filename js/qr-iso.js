/**
 * SeñaSegura · Generador local de códigos QR ISO/IEC 18004 (Versiones V1–V6, Nivel M)
 * Construye URLs verificables de constancias y matrices SVG puras sin red ni dependencias externas.
 */
(() => {
  'use strict';

  const QR_GF_EXP = new Uint8Array(512);
  const QR_GF_LOG = new Uint8Array(256);
  (() => {
    let val = 1;
    for (let i = 0; i < 255; i += 1) {
      QR_GF_EXP[i] = val;
      QR_GF_LOG[val] = i;
      val <<= 1;
      if (val & 0x100) val ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) {
      QR_GF_EXP[i] = QR_GF_EXP[i - 255];
    }
  })();

  // Códigos de formato ISO/IEC 18004 (ECC Level M = 00, máscaras 0..7 con XOR 0x5412)
  const QR_FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

  const QR_VERSIONS_M = [
    { ver: 1, size: 21, maxBytes: 14, totalData: 16, ecPerBlock: 10, blocks: [16], align: [], rem: 0 },
    { ver: 2, size: 25, maxBytes: 26, totalData: 28, ecPerBlock: 16, blocks: [28], align: [6, 18], rem: 7 },
    { ver: 3, size: 29, maxBytes: 42, totalData: 44, ecPerBlock: 26, blocks: [44], align: [6, 22], rem: 7 },
    { ver: 4, size: 33, maxBytes: 62, totalData: 64, ecPerBlock: 18, blocks: [32, 32], align: [6, 26], rem: 7 },
    { ver: 5, size: 37, maxBytes: 84, totalData: 86, ecPerBlock: 24, blocks: [43, 43], align: [6, 30], rem: 7 },
    { ver: 6, size: 41, maxBytes: 106, totalData: 108, ecPerBlock: 16, blocks: [27, 27, 27, 27], align: [6, 34], rem: 7 }
  ];

  function qrGfMul(a, b) {
    return a === 0 || b === 0 ? 0 : QR_GF_EXP[QR_GF_LOG[a] + QR_GF_LOG[b]];
  }

  function qrRsRemainder(data, ecCount) {
    let gen = [1];
    for (let i = 0; i < ecCount; i += 1) {
      const nxt = new Array(gen.length + 1).fill(0);
      const root = QR_GF_EXP[i];
      for (let j = 0; j < gen.length; j += 1) {
        nxt[j] ^= gen[j];
        nxt[j + 1] ^= qrGfMul(gen[j], root);
      }
      gen = nxt;
    }
    const msg = data.concat(new Array(ecCount).fill(0));
    for (let i = 0; i < data.length; i += 1) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j += 1) {
          msg[i + j] ^= qrGfMul(gen[j], coef);
        }
      }
    }
    return msg.slice(data.length);
  }

  function encodeUtf8Bytes(text) {
    if (typeof TextEncoder === 'function') {
      return Array.from(new TextEncoder().encode(String(text)));
    }
    return Array.from(String(text)).map((ch) => ch.charCodeAt(0) & 0xff);
  }

  /**
   * Construye la URL de verificación directa para el QR del comprobante.
   * Garantiza compatibilidad <=106 bytes (QR V1–V6 Nivel M).
   */
  function buildReceiptVerifyUrl(code, sector = '', procedure = '') {
    const querySuffix = `?verificar=${encodeURIComponent(code)}#marco-legal`;
    const detailSuffix = `?verificar=${encodeURIComponent(code)}&s=${encodeURIComponent(sector || '')}&m=${encodeURIComponent(procedure || '')}#marco-legal`;
    try {
      if (sector || procedure) {
        const detailedUrl = new URL(`index.html${detailSuffix}`, window.location.href).href;
        if (encodeUtf8Bytes(detailedUrl).length <= 106) return detailedUrl;
      }
      const fullUrl = new URL(`index.html${querySuffix}`, window.location.href).href;
      if (encodeUtf8Bytes(fullUrl).length <= 106) return fullUrl;
    } catch (_) {
      /* URL relativa de respaldo en contextos no estándar */
    }
    const shortUrl = `pages/index.html${querySuffix}`;
    return encodeUtf8Bytes(shortUrl).length <= 106 ? shortUrl : code;
  }

  /**
   * Codifica texto o URL (<=106 bytes UTF-8) en matriz QR ISO/IEC 18004 (V1–V6 Nivel M).
   * Cero dependencias externas y cero errores en redes offline o restringidas.
   */
  function encodeIsoQrMatrix(text) {
    const raw = encodeUtf8Bytes(text);
    const spec = QR_VERSIONS_M.find((v) => raw.length <= v.maxBytes);
    if (!spec) return null;

    const { ver, size, totalData: dataLen, ecPerBlock: ecLen, blocks, align, rem } = spec;

    const bits = [];
    const pushBits = (val, n) => {
      for (let b = n - 1; b >= 0; b -= 1) bits.push((val >> b) & 1);
    };
    pushBits(0b0100, 4); // Modo byte
    pushBits(raw.length, 8);
    raw.forEach((b) => pushBits(b, 8));
    pushBits(0, Math.min(4, dataLen * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i + b];
      codewords.push(byte);
    }
    const pads = [0xec, 0x11];
    let padIdx = 0;
    while (codewords.length < dataLen) {
      codewords.push(pads[padIdx & 1]);
      padIdx += 1;
    }

    // División en bloques y entrelazado estándar ISO/IEC 18004 (V1–V6)
    let offset = 0;
    const dataBlocks = blocks.map((count) => {
      const slice = codewords.slice(offset, offset + count);
      offset += count;
      return slice;
    });
    const ecBlocks = dataBlocks.map((blk) => qrRsRemainder(blk, ecLen));
    const full = [];
    const maxDataLen = Math.max(...blocks);
    for (let i = 0; i < maxDataLen; i += 1) {
      dataBlocks.forEach((blk) => {
        if (i < blk.length) full.push(blk[i]);
      });
    }
    for (let i = 0; i < ecLen; i += 1) {
      ecBlocks.forEach((ec) => {
        if (i < ec.length) full.push(ec[i]);
      });
    }

    const stream = [];
    full.forEach((byte) => {
      for (let b = 7; b >= 0; b -= 1) stream.push((byte >> b) & 1);
    });
    const totalDataBits = full.length * 8 + rem;
    while (stream.length < totalDataBits) stream.push(0);

    const base = Array.from({ length: size }, () => new Uint8Array(size));
    const func = Array.from({ length: size }, () => new Uint8Array(size));
    const setFn = (r, c, v) => {
      if (r >= 0 && r < size && c >= 0 && c < size) {
        base[r][c] = v ? 1 : 0;
        func[r][c] = 1;
      }
    };

    const drawFinder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr += 1) {
        for (let dc = -1; dc <= 7; dc += 1) {
          const dark =
            dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
            (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          setFn(r0 + dr, c0 + dc, dark);
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    for (let i = 0; i < align.length; i += 1) {
      for (let j = 0; j < align.length; j += 1) {
        const ar = align[i];
        const ac = align[j];
        const inTopLeft = ar <= 8 && ac <= 8;
        const inTopRight = ar <= 8 && ac >= size - 9;
        const inBottomLeft = ar >= size - 9 && ac <= 8;
        if (inTopLeft || inTopRight || inBottomLeft) continue;
        for (let dr = -2; dr <= 2; dr += 1) {
          for (let dc = -2; dc <= 2; dc += 1) {
            setFn(ar + dr, ac + dc, Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0));
          }
        }
      }
    }

    for (let i = 8; i < size - 8; i += 1) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }

    for (let i = 0; i <= 8; i += 1) {
      if (!func[8][i]) setFn(8, i, 0);
      if (!func[i][8]) setFn(i, 8, 0);
    }
    for (let i = size - 8; i < size; i += 1) {
      if (!func[8][i]) setFn(8, i, 0);
    }
    for (let i = size - 7; i < size; i += 1) {
      if (!func[i][8]) setFn(i, 8, 0);
    }
    setFn(4 * ver + 9, 8, 1);

    let bi = 0;
    let up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (let step = 0; step < size; step += 1) {
        const r = up ? size - 1 - step : step;
        for (let off = 0; off < 2; off += 1) {
          const c = col - off;
          if (!func[r][c]) {
            base[r][c] = stream[bi] || 0;
            bi += 1;
          }
        }
      }
      up = !up;
    }

    const maskPredicates = [
      (r, c) => (r + c) % 2 === 0,
      (r) => r % 2 === 0,
      (_, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
      (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    ];

    const writeFormat = (grid, fmtBits) => {
      const copy1 = [
        [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
        [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
      ];
      for (let i = 0; i < 15; i += 1) {
        const bit = (fmtBits >> (14 - i)) & 1;
        const [r1, c1] = copy1[i];
        grid[r1][c1] = bit;
        if (i < 7) {
          grid[size - 1 - i][8] = bit;
        } else {
          grid[8][size - 15 + i] = bit;
        }
      }
    };

    const penaltyScore = (grid) => {
      let score = 0;
      let darkCount = 0;
      for (let r = 0; r < size; r += 1) {
        let rowRun = 1;
        let colRun = 1;
        for (let c = 0; c < size; c += 1) {
          if (grid[r][c]) darkCount += 1;
          if (c > 0) {
            if (grid[r][c] === grid[r][c - 1]) rowRun += 1;
            else {
              if (rowRun >= 5) score += rowRun - 2;
              rowRun = 1;
            }
            if (grid[c][r] === grid[c - 1][r]) colRun += 1;
            else {
              if (colRun >= 5) score += colRun - 2;
              colRun = 1;
            }
          }
          if (r > 0 && c > 0 && grid[r][c] === grid[r - 1][c] && grid[r][c] === grid[r][c - 1] && grid[r][c] === grid[r - 1][c - 1]) {
            score += 3;
          }
        }
        if (rowRun >= 5) score += rowRun - 2;
        if (colRun >= 5) score += colRun - 2;
      }
      const darkPct = (darkCount * 100) / (size * size);
      score += Math.floor(Math.abs(darkPct - 50) / 5) * 10;
      return score;
    };

    let bestGrid = null;
    let bestScore = Infinity;
    for (let m = 0; m < 8; m += 1) {
      const pred = maskPredicates[m];
      const masked = base.map((row, r) => row.map((v, c) => (func[r][c] ? v : v ^ (pred(r, c) ? 1 : 0))));
      writeFormat(masked, QR_FORMAT_M[m]);
      const sc = penaltyScore(masked);
      if (sc < bestScore) {
        bestScore = sc;
        bestGrid = masked;
      }
    }
    return bestGrid;
  }

  /**
   * Genera un código QR ISO/IEC 18004 escaneable en nodo SVG puro (DOM explícito).
   */
  function buildDynamicQrSvg(payload, labelCode = payload) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const matrix = encodeIsoQrMatrix(payload);
    const size = matrix ? matrix.length : 21;
    const quietZone = 2;
    const total = size + quietZone * 2;

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', '148');
    svg.setAttribute('height', '148');
    svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Código QR verificable ${labelCode}`);

    const bg = document.createElementNS(svgNs, 'rect');
    bg.setAttribute('width', String(total));
    bg.setAttribute('height', String(total));
    bg.setAttribute('fill', '#FFFFFF');
    svg.appendChild(bg);

    let pathData = '';
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (matrix && matrix[r][c]) {
          pathData += `M${c + quietZone},${r + quietZone}h1v1h-1z`;
        }
      }
    }

    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', '#0A2540');
    svg.appendChild(path);
    return svg;
  }

  window.SenaSeguraQR = Object.freeze({
    encodeUtf8Bytes,
    buildReceiptVerifyUrl,
    encodeIsoQrMatrix,
    buildDynamicQrSvg
  });
})();
