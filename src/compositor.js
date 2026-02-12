/**
 * Display screenshot compositor
 *
 * Generates professional marketing screenshots with:
 * - Floating device mockup with drop shadow (no thick bezel)
 * - Rich gradient backgrounds with radial accent
 * - Bold headline/subtext with generous spacing
 * - Modern 2025/2026 App Store aesthetic
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Display output dimensions
const DISPLAY_DIMENSIONS = {
  '6.9inch': {
    width: 1320,
    height: 2868,
    // Device is scaled to ~72% of canvas width for breathing room
    deviceScale: 0.72,
    cornerRadius: 72, // Scaled corner radius for the smaller device
    name: 'iPhone 6.9"',
  },
  '6.5inch': {
    width: 1242,
    height: 2688,
    deviceScale: 0.72,
    cornerRadius: 68,
    name: 'iPhone 6.5"',
  },
};

// Curated gradient palettes that work well for App Store screenshots
const GRADIENT_PALETTES = [
  ['#6366F1', '#8B5CF6', '#A78BFA'], // Indigo → Purple
  ['#3B82F6', '#6366F1', '#8B5CF6'], // Blue → Indigo → Purple
  ['#EC4899', '#8B5CF6', '#6366F1'], // Pink → Purple → Indigo
  ['#F59E0B', '#EF4444', '#EC4899'], // Amber → Red → Pink
  ['#10B981', '#06B6D4', '#3B82F6'], // Emerald → Cyan → Blue
  ['#1E293B', '#334155', '#475569'], // Dark slate
];

/**
 * Convert hex color to RGBA object for sharp
 */
function hexToRgba(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16), alpha: 1 }
    : { r: 0, g: 0, b: 0, alpha: 1 };
}

/**
 * Lighten a hex color by a factor (0-1)
 */
function lightenColor(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lighten = (c) => Math.min(255, Math.round(c + (255 - c) * factor));
  return '#' + [lighten(r), lighten(g), lighten(b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Darken a hex color by a factor (0-1)
 */
function darkenColor(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const darken = (c) => Math.max(0, Math.round(c * (1 - factor)));
  return '#' + [darken(r), darken(g), darken(b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Create rich gradient background with radial accent for depth
 */
async function createBackground(width, height, background) {
  if (!background || background.type === 'solid') {
    const color = (background && background.color) || '#000000';
    return sharp({
      create: { width, height, channels: 4, background: hexToRgba(color) },
    })
      .png()
      .toBuffer();
  }

  const colors = background.colors || ['#6366F1', '#8B5CF6'];
  const angle = background.angle || 180;

  // Calculate gradient direction
  let x1 = '0%', y1 = '0%', x2 = '0%', y2 = '100%';
  if (angle === 0) { x1 = '0%'; y1 = '100%'; x2 = '0%'; y2 = '0%'; }
  else if (angle === 90) { x1 = '0%'; y1 = '0%'; x2 = '100%'; y2 = '0%'; }
  else if (angle === 135) { x1 = '0%'; y1 = '0%'; x2 = '100%'; y2 = '100%'; }
  else if (angle === 270) { x1 = '100%'; y1 = '0%'; x2 = '0%'; y2 = '0%'; }

  // Build gradient stops — if only 2 colors, add a middle stop for richness
  let effectiveColors = colors;
  if (colors.length === 2) {
    // Derive a midpoint color by blending the two
    const midColor = lightenColor(colors[0], 0.15);
    effectiveColors = [colors[0], midColor, colors[1]];
  }

  let stops = '';
  effectiveColors.forEach((c, i) => {
    const offset = Math.round((i / (effectiveColors.length - 1)) * 100);
    stops += `<stop offset="${offset}%" style="stop-color:${c};stop-opacity:1" />\n`;
  });

  // Main linear gradient + radial accent glow for depth
  const accentColor = lightenColor(effectiveColors[0], 0.3);

  const svgGradient = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mainGrad" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
          ${stops}
        </linearGradient>
        <radialGradient id="accentGlow" cx="50%" cy="25%" r="60%" fx="50%" fy="25%">
          <stop offset="0%" style="stop-color:${accentColor};stop-opacity:0.35" />
          <stop offset="100%" style="stop-color:${accentColor};stop-opacity:0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#mainGrad)"/>
      <rect width="100%" height="100%" fill="url(#accentGlow)"/>
    </svg>
  `;

  return sharp(Buffer.from(svgGradient)).png().toBuffer();
}

/**
 * Create the device mockup: rounded corners + thin subtle border + drop shadow
 * Modern style — no thick dark bezel, just a clean floating device
 */
async function createDeviceMockup(screenBuffer, deviceWidth, deviceHeight, cornerRadius) {
  const borderWidth = 4; // Subtle thin border
  const shadowPad = 60;  // Space for drop shadow
  const totalWidth = deviceWidth + borderWidth * 2 + shadowPad * 2;
  const totalHeight = deviceHeight + borderWidth * 2 + shadowPad * 2;

  // 1. Resize screen to device dimensions
  const resizedScreen = await sharp(screenBuffer)
    .resize(deviceWidth, deviceHeight, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  // 2. Apply rounded corner mask to screen
  const mask = Buffer.from(`
    <svg width="${deviceWidth}" height="${deviceHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${deviceWidth}" height="${deviceHeight}"
        rx="${cornerRadius}" ry="${cornerRadius}" fill="white"/>
    </svg>
  `);

  const maskedScreen = await sharp(resizedScreen)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 3. Create the container with drop shadow
  const containerSvg = `
    <svg width="${totalWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="deviceShadow" x="-20%" y="-10%" width="140%" height="130%">
          <feDropShadow dx="0" dy="12" stdDeviation="28" flood-color="rgba(0,0,0,0.35)"/>
        </filter>
      </defs>
      <!-- Thin border + shadow -->
      <rect x="${shadowPad}" y="${shadowPad}"
        width="${deviceWidth + borderWidth * 2}" height="${deviceHeight + borderWidth * 2}"
        rx="${cornerRadius + borderWidth}" ry="${cornerRadius + borderWidth}"
        fill="rgba(0,0,0,0.12)"
        filter="url(#deviceShadow)"/>
      <!-- Thin bright border (subtle edge) -->
      <rect x="${shadowPad}" y="${shadowPad}"
        width="${deviceWidth + borderWidth * 2}" height="${deviceHeight + borderWidth * 2}"
        rx="${cornerRadius + borderWidth}" ry="${cornerRadius + borderWidth}"
        fill="rgba(255,255,255,0.08)"
        stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    </svg>
  `;

  const containerBuffer = await sharp(Buffer.from(containerSvg)).png().toBuffer();

  // 4. Composite screen onto container
  return {
    buffer: await sharp(containerBuffer)
      .composite([{
        input: maskedScreen,
        top: shadowPad + borderWidth,
        left: shadowPad + borderWidth,
      }])
      .png()
      .toBuffer(),
    totalWidth,
    totalHeight,
    shadowPad,
    borderWidth,
  };
}

/**
 * Add headline and subtext overlay — modern bold typography
 */
async function addTextOverlay(backgroundBuffer, headline, subtext, position, textColor, width, height, textAreaHeight) {
  // Larger, bolder headline for impact
  const headlineFontSize = 120; // 40pt at @3x — big and bold
  const subtextFontSize = 54;   // 18pt at @3x
  const padding = 100;

  let headlineY, subtextY;
  if (position === 'top') {
    // Center text in the text area above the device
    const textBlockHeight = headlineFontSize + (subtext ? subtextFontSize + 30 : 0);
    const startY = Math.round((textAreaHeight - textBlockHeight) / 2) + headlineFontSize * 0.8;
    headlineY = Math.max(padding + headlineFontSize, startY);
    subtextY = headlineY + subtextFontSize + 36;
  } else {
    headlineY = height - padding - (subtext ? subtextFontSize + 42 : 0);
    subtextY = height - padding;
  }

  const escapeXml = (text) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const safeHeadline = escapeXml(headline);
  const safeSubtext = subtext ? escapeXml(subtext) : '';

  const textSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="rgba(0,0,0,0.25)"/>
        </filter>
      </defs>
      <style>
        .headline {
          font-family: 'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-weight: 800;
          font-size: ${headlineFontSize}px;
          fill: ${textColor};
          letter-spacing: -0.03em;
        }
        .subtext {
          font-family: 'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-weight: 500;
          font-size: ${subtextFontSize}px;
          fill: ${textColor};
          opacity: 0.85;
          letter-spacing: 0.01em;
        }
      </style>
      <text x="${width / 2}" y="${headlineY}" text-anchor="middle" class="headline" filter="url(#textShadow)">${safeHeadline}</text>
      ${safeSubtext ? `<text x="${width / 2}" y="${subtextY}" text-anchor="middle" class="subtext" filter="url(#textShadow)">${safeSubtext}</text>` : ''}
    </svg>
  `;

  const textBuffer = await sharp(Buffer.from(textSvg)).png().toBuffer();

  return sharp(backgroundBuffer)
    .composite([{ input: textBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * Add a gradient overlay at the bottom for text readability
 */
async function addBottomGradient(buffer, width, height) {
  const gradientHeight = 500;
  const gradientSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bottomGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:rgba(0,0,0,0);stop-opacity:0" />
          <stop offset="100%" style="stop-color:rgba(0,0,0,0.65);stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect x="0" y="${height - gradientHeight}" width="${width}" height="${gradientHeight}" fill="url(#bottomGrad)"/>
    </svg>
  `;

  const gradientBuffer = await sharp(Buffer.from(gradientSvg)).png().toBuffer();
  return sharp(buffer)
    .composite([{ input: gradientBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * Generate a single display screenshot
 */
async function generateDisplayScreenshot(screenshotPath, options) {
  const size = options.size || '6.9inch';
  const dim = DISPLAY_DIMENSIONS[size];
  if (!dim) throw new Error(`Unknown display size: ${size}`);

  const textPosition = options.textPosition || 'top';
  const textColor = options.textColor || '#FFFFFF';
  const background = options.background || { type: 'gradient', colors: ['#6366F1', '#8B5CF6'] };

  // Calculate device dimensions (scaled down for breathing room)
  const deviceWidth = Math.round(dim.width * dim.deviceScale);
  const deviceHeight = Math.round(deviceWidth * (2796 / 1290)); // iPhone aspect ratio
  // Cap height so device doesn't overflow canvas
  const maxDeviceHeight = Math.round(dim.height * 0.78);
  const finalDeviceHeight = Math.min(deviceHeight, maxDeviceHeight);

  // 1. Read screen
  const screenBuffer = fs.readFileSync(screenshotPath);

  // 2. Create floating device mockup (rounded corners + shadow, no thick bezel)
  const device = await createDeviceMockup(screenBuffer, deviceWidth, finalDeviceHeight, dim.cornerRadius);

  // 3. Create rich gradient background
  const backgroundBuffer = await createBackground(dim.width, dim.height, background);

  // 4. Position device on background
  const deviceX = Math.round((dim.width - device.totalWidth) / 2);

  // Text area = space above (or below) the device
  let deviceY;
  let textAreaHeight;
  if (!options.headline) {
    deviceY = Math.round((dim.height - device.totalHeight) / 2);
    textAreaHeight = 0;
  } else if (textPosition === 'top') {
    // Give generous space for headline above device
    textAreaHeight = Math.round(dim.height * 0.18);
    deviceY = textAreaHeight - device.shadowPad;
    // Let device extend slightly below canvas (bottom cropped) for modern look
  } else {
    // Device at top, text at bottom
    deviceY = -device.shadowPad + 20;
    textAreaHeight = dim.height - finalDeviceHeight - 40;
  }

  // 5. Composite device onto background
  let finalBuffer = await sharp(backgroundBuffer)
    .composite([{ input: device.buffer, top: deviceY, left: deviceX }])
    .png()
    .toBuffer();

  // 6. Add bottom gradient for text readability if text at bottom
  if (textPosition === 'bottom' && options.headline) {
    finalBuffer = await addBottomGradient(finalBuffer, dim.width, dim.height);
  }

  // 7. Add text overlay
  if (options.headline) {
    finalBuffer = await addTextOverlay(
      finalBuffer,
      options.headline,
      options.subtext || null,
      textPosition,
      textColor,
      dim.width,
      dim.height,
      textAreaHeight
    );
  }

  // 8. Save
  const outputDir = path.dirname(options.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await sharp(finalBuffer).png().toFile(options.outputPath);

  return options.outputPath;
}

/**
 * Generate display screenshots for all captured screens
 */
async function generateDisplayScreenshots(rawScreenshots, metadata, outputDir, displayConfig) {
  const results = [];

  // De-duplicate screens
  const uniqueScreens = [];
  const seenNames = new Set();
  for (const ss of rawScreenshots) {
    if (!seenNames.has(ss.name)) {
      seenNames.add(ss.name);
      uniqueScreens.push(ss);
    }
  }

  const defaultHeadlines = {
    main: metadata.appName,
    detail: 'Discover more',
    settings: 'Your way',
    profile: 'All about you',
  };

  for (let i = 0; i < uniqueScreens.length; i++) {
    const screenshot = uniqueScreens[i];

    const screenConfig = (displayConfig && displayConfig[screenshot.name]) || {};

    const headline = screenConfig.headline || defaultHeadlines[screenshot.name] || metadata.appName;
    const subtext = screenConfig.subtext || null;
    const background = screenConfig.background || {
      type: 'gradient',
      colors: [metadata.primaryColor, metadata.accentColor],
    };
    const textPosition = screenConfig.textPosition || (i % 2 === 0 ? 'top' : 'bottom');
    const textColor = screenConfig.textColor || '#FFFFFF';

    const filename = `${String(i + 1).padStart(2, '0')}-${screenshot.name}-hero.png`;
    const outputPath = path.join(outputDir, 'display', filename);

    console.log(`  Compositing display: ${screenshot.name} → "${headline}"`);

    await generateDisplayScreenshot(screenshot.path, {
      headline,
      subtext,
      background,
      textPosition,
      textColor,
      size: screenshot.size || '6.9inch',
      outputPath,
    });

    results.push({ name: screenshot.name, path: outputPath });
  }

  return results;
}

module.exports = {
  generateDisplayScreenshot,
  generateDisplayScreenshots,
  createBackground,
  createDeviceMockup,
  addTextOverlay,
  DISPLAY_DIMENSIONS,
  GRADIENT_PALETTES,
};
