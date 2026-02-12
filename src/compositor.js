/**
 * Display screenshot compositor
 *
 * Generates polished marketing screenshots with:
 * - Device frames (rounded corners + metallic bezel)
 * - Gradient or solid color backgrounds
 * - Headline/subtext overlays with shadow
 *
 * Adapted from vacation-photos project compositor.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Display output dimensions (same as App Store submission sizes)
const DISPLAY_DIMENSIONS = {
  '6.9inch': {
    width: 1320,
    height: 2868,
    screenWidth: 1290,
    screenHeight: 2796,
    cornerRadius: 110,
    name: 'iPhone 6.9"',
  },
  '6.5inch': {
    width: 1242,
    height: 2688,
    screenWidth: 1218,
    screenHeight: 2664,
    cornerRadius: 100,
    name: 'iPhone 6.5"',
  },
};

// Style presets for display screenshots
const STYLE_PRESETS = {
  'gradient-bold': {
    backgroundType: 'gradient',
    textPosition: 'top',
    textColor: '#FFFFFF',
  },
  'dark-premium': {
    backgroundType: 'solid',
    backgroundColor: '#1A1A2E',
    textPosition: 'top',
    textColor: '#FFFFFF',
  },
  'minimal-light': {
    backgroundType: 'solid',
    backgroundColor: '#F8FAFC',
    textPosition: 'top',
    textColor: '#1E293B',
  },
};

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
 * Create gradient or solid background
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

  // Gradient background
  const colors = background.colors || ['#6366F1', '#8B5CF6'];
  const angle = background.angle || 180;

  // Calculate gradient direction
  let x1 = '0%', y1 = '0%', x2 = '0%', y2 = '100%';
  if (angle === 0) { x1 = '0%'; y1 = '100%'; x2 = '0%'; y2 = '0%'; }
  else if (angle === 90) { x1 = '0%'; y1 = '0%'; x2 = '100%'; y2 = '0%'; }
  else if (angle === 135) { x1 = '0%'; y1 = '0%'; x2 = '100%'; y2 = '100%'; }
  else if (angle === 270) { x1 = '100%'; y1 = '0%'; x2 = '0%'; y2 = '0%'; }
  // default: 180 (top to bottom)

  // Support multiple gradient stops
  let stops = '';
  if (colors.length === 2) {
    stops = `
      <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
    `;
  } else {
    colors.forEach((c, i) => {
      const offset = Math.round((i / (colors.length - 1)) * 100);
      stops += `<stop offset="${offset}%" style="stop-color:${c};stop-opacity:1" />\n`;
    });
  }

  const svgGradient = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
          ${stops}
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grad)"/>
    </svg>
  `;

  return sharp(Buffer.from(svgGradient)).png().toBuffer();
}

/**
 * Apply rounded corners to a screen image (device frame mask)
 */
async function createDeviceFrame(screenBuffer, screenWidth, screenHeight, cornerRadius) {
  const mask = Buffer.from(`
    <svg width="${screenWidth}" height="${screenHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${screenWidth}" height="${screenHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="white"/>
    </svg>
  `);

  const resizedScreen = await sharp(screenBuffer)
    .resize(screenWidth, screenHeight, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  return sharp(resizedScreen)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/**
 * Add metallic device bezel around the screen
 */
async function addDeviceBezel(screenBuffer, width, height, cornerRadius) {
  const bezelWidth = 12; // 4pt * 3 for @3x

  const bezelSvg = `
    <svg width="${width + bezelWidth * 2}" height="${height + bezelWidth * 2}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bezel" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#2D2D2D"/>
          <stop offset="50%" style="stop-color:#1A1A1A"/>
          <stop offset="100%" style="stop-color:#0D0D0D"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width + bezelWidth * 2}" height="${height + bezelWidth * 2}"
        rx="${cornerRadius + bezelWidth}" ry="${cornerRadius + bezelWidth}"
        fill="url(#bezel)"/>
    </svg>
  `;

  const bezelBuffer = await sharp(Buffer.from(bezelSvg)).png().toBuffer();

  return sharp(bezelBuffer)
    .composite([{ input: screenBuffer, top: bezelWidth, left: bezelWidth }])
    .png()
    .toBuffer();
}

/**
 * Add headline and subtext overlay
 */
async function addTextOverlay(backgroundBuffer, headline, subtext, position, textColor, width, height) {
  const headlineFontSize = 96; // 32pt at @3x
  const subtextFontSize = 48;  // 16pt at @3x
  const padding = 90;

  let headlineY, subtextY;
  if (position === 'top') {
    headlineY = padding + headlineFontSize;
    subtextY = headlineY + subtextFontSize + 24;
  } else {
    headlineY = height - padding - (subtext ? subtextFontSize + 36 : 0);
    subtextY = height - padding;
  }

  // Escape XML special characters in text
  const escapeXml = (text) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const safeHeadline = escapeXml(headline);
  const safeSubtext = subtext ? escapeXml(subtext) : '';

  const textSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="rgba(0,0,0,0.3)"/>
        </filter>
      </defs>
      <style>
        .headline {
          font-family: 'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-weight: 800;
          font-size: ${headlineFontSize}px;
          fill: ${textColor};
          letter-spacing: -0.02em;
        }
        .subtext {
          font-family: 'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-weight: 600;
          font-size: ${subtextFontSize}px;
          fill: ${textColor};
          opacity: 0.95;
          letter-spacing: 0.02em;
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
  const gradientHeight = 400;
  const gradientSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bottomGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:rgba(0,0,0,0);stop-opacity:0" />
          <stop offset="100%" style="stop-color:rgba(0,0,0,0.7);stop-opacity:1" />
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
 *
 * @param {string} screenshotPath - Path to raw simulator screenshot
 * @param {object} options
 * @param {string} options.headline - Marketing headline text
 * @param {string} [options.subtext] - Secondary text
 * @param {object} [options.background] - { type: 'gradient'|'solid', colors: [], color: '#hex' }
 * @param {string} [options.textPosition] - 'top' or 'bottom'
 * @param {string} [options.textColor] - '#FFFFFF'
 * @param {string} [options.size] - '6.9inch' or '6.5inch'
 * @param {string} options.outputPath - Where to save the result
 */
async function generateDisplayScreenshot(screenshotPath, options) {
  const size = options.size || '6.9inch';
  const dim = DISPLAY_DIMENSIONS[size];
  if (!dim) throw new Error(`Unknown display size: ${size}`);

  const textPosition = options.textPosition || 'top';
  const textColor = options.textColor || '#FFFFFF';
  const background = options.background || { type: 'gradient', colors: ['#6366F1', '#8B5CF6'] };

  // 1. Read and resize screen to device dimensions
  const screenBuffer = fs.readFileSync(screenshotPath);

  // 2. Apply rounded corners
  const framedScreen = await createDeviceFrame(screenBuffer, dim.screenWidth, dim.screenHeight, dim.cornerRadius);

  // 3. Add device bezel
  const deviceBuffer = await addDeviceBezel(framedScreen, dim.screenWidth, dim.screenHeight, dim.cornerRadius);

  // 4. Create background
  const backgroundBuffer = await createBackground(dim.width, dim.height, background);

  // 5. Position device on background
  const bezelWidth = 12;
  const deviceWidth = dim.screenWidth + bezelWidth * 2;
  const deviceHeight = dim.screenHeight + bezelWidth * 2;
  const deviceX = Math.round((dim.width - deviceWidth) / 2);

  let deviceY;
  if (!options.headline) {
    deviceY = Math.round((dim.height - deviceHeight) / 2);
  } else if (textPosition === 'top') {
    deviceY = 240;
  } else {
    deviceY = 24;
  }

  // 6. Composite device onto background
  let finalBuffer = await sharp(backgroundBuffer)
    .composite([{ input: deviceBuffer, top: deviceY, left: deviceX }])
    .png()
    .toBuffer();

  // 7. Add bottom gradient for text readability if text at bottom
  if (textPosition === 'bottom' && options.headline) {
    finalBuffer = await addBottomGradient(finalBuffer, dim.width, dim.height);
  }

  // 8. Add text overlay
  if (options.headline) {
    finalBuffer = await addTextOverlay(
      finalBuffer,
      options.headline,
      options.subtext || null,
      textPosition,
      textColor,
      dim.width,
      dim.height
    );
  }

  // 9. Save
  const outputDir = path.dirname(options.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await sharp(finalBuffer).png().toFile(options.outputPath);

  return options.outputPath;
}

/**
 * Generate display screenshots for all captured screens
 *
 * @param {Array<{size: string, name: string, path: string}>} rawScreenshots
 * @param {object} metadata - { appName, primaryColor, accentColor }
 * @param {string} outputDir - Base output directory
 * @param {object} [displayConfig] - Per-screen config from config file
 * @returns {Array<{name: string, path: string}>}
 */
async function generateDisplayScreenshots(rawScreenshots, metadata, outputDir, displayConfig) {
  const results = [];

  // De-duplicate screens (use first captured version)
  const uniqueScreens = [];
  const seenNames = new Set();
  for (const ss of rawScreenshots) {
    if (!seenNames.has(ss.name)) {
      seenNames.add(ss.name);
      uniqueScreens.push(ss);
    }
  }

  // Default headlines based on screen name
  const defaultHeadlines = {
    main: metadata.appName,
    detail: 'Discover more',
    settings: 'Your way',
    profile: 'All about you',
  };

  for (let i = 0; i < uniqueScreens.length; i++) {
    const screenshot = uniqueScreens[i];

    // Get display config for this screen (from config file or defaults)
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
  createDeviceFrame,
  addDeviceBezel,
  addTextOverlay,
  DISPLAY_DIMENSIONS,
  STYLE_PRESETS,
};
