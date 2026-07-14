// Tile a set of cover PNGs into one contact-sheet montage.
// Usage: node _montage.mjs <outPng> <cols> <cellPx> <img1> <img2> ...
import sharp from "sharp";
const [, , outPng, colsS, cellS, ...imgs] = process.argv;
const cols = Number(colsS), cell = Number(cellS), gap = 12, pad = 16;
const rows = Math.ceil(imgs.length / cols);
const W = pad * 2 + cols * cell + (cols - 1) * gap;
const H = pad * 2 + rows * cell + (rows - 1) * gap;
const cells = await Promise.all(imgs.map((p) => sharp(p).resize(cell, cell, { fit: "cover" }).toBuffer()));
const composites = cells.map((buf, i) => ({
  input: buf,
  left: pad + (i % cols) * (cell + gap),
  top: pad + Math.floor(i / cols) * (cell + gap),
}));
await sharp({ create: { width: W, height: H, channels: 3, background: { r: 10, g: 12, b: 10 } } })
  .composite(composites).png().toFile(outPng);
console.log(`${outPng} (${W}x${H}, ${imgs.length} covers)`);
