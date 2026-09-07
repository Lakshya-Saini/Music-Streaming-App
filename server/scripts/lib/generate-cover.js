/**
 * Renders a square abstract album-cover JPEG with ffmpeg: a solid-color
 * background, a diagonal color-block band, and a glossy accent orb, finished
 * with a light vignette and film grain. Pure lavfi filters (color/geq/perlin)
 * so no image libraries (sharp/canvas/ImageMagick) are required.
 */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const SIZE = 1500;

function buildShapeExpr(channelIndex, theme) {
  const { orb, band, bg } = theme;
  const [bgC, bandC, orbCenter, orbEdge] = [bg.rgb, band.color, orb.centerColor, orb.edgeColor].map(
    (c) => c[channelIndex],
  );

  const orbDist = `((X-${orb.cx})*(X-${orb.cx})+(Y-${orb.cy})*(Y-${orb.cy}))`;
  const orbR2 = `(${orb.r}*${orb.r})`;
  const ringR2 = `((${orb.r}+6)*(${orb.r}+6))`;
  // Linear interpolation from center color to edge color across the orb radius,
  // giving it a glossy, lit-from-one-side sphere look instead of a flat disc.
  const orbShade = `(${orbCenter}+(${orbEdge}-${orbCenter})*sqrt(${orbDist})/${orb.r})`;
  const ringShade = Math.min(255, Math.round(orbEdge + (255 - orbEdge) * 0.22));
  const inOrb = `lt(${orbDist},${orbR2})`;
  const inRing = `lt(${orbDist},${ringR2})`;
  const inBand = `${band.compare}(Y,${band.slope}*X+${band.intercept})`;

  return `if(${inOrb},${orbShade},if(${inRing},${ringShade},if(${inBand},${bandC},${bgC})))`;
}

/**
 * theme = {
 *   bg: { hex: '0xRRGGBB', rgb: [r,g,b] },
 *   orb: { cx, cy, r, centerColor: [r,g,b], edgeColor: [r,g,b] },
 *   band: { compare: 'gt'|'lt', slope, intercept, color: [r,g,b] },
 *   seed: number,
 * }
 */
async function generateCover(ffmpegPath, outputPath, theme) {
  const rExpr = buildShapeExpr(0, theme);
  const gExpr = buildShapeExpr(1, theme);
  const bExpr = buildShapeExpr(2, theme);

  const filterComplex =
    `[0:v]geq=r='${rExpr}':g='${gExpr}':b='${bExpr}'[base];` +
    `[1:v]format=gray[noise];` +
    `[base][noise]blend=all_mode=overlay:all_opacity=0.05,` +
    `vignette=PI/4.6:mode=forward,` +
    `eq=saturation=1.28:contrast=1.06:brightness=0.015,` +
    `format=yuvj420p`;

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${theme.bg.hex}:s=${SIZE}x${SIZE}`,
    '-f', 'lavfi', '-i', `perlin=s=${SIZE}x${SIZE}:octaves=3:seed=${theme.seed}`,
    '-filter_complex', filterComplex,
    '-frames:v', '1',
    '-q:v', '2',
    outputPath,
  ];

  await execFileAsync(ffmpegPath, args);
}

module.exports = { generateCover, SIZE };
