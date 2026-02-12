/**
 * Submission screenshot generator
 *
 * Takes raw simulator screenshots and resizes them to exact
 * App Store submission dimensions. No enhancements — just
 * properly sized PNGs ready for App Store Connect.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// App Store required dimensions
const APP_STORE_SIZES = {
  '6.9inch': { width: 1320, height: 2868, name: 'iPhone 6.9"' },
  '6.5inch': { width: 1242, height: 2688, name: 'iPhone 6.5"' },
};

/**
 * Resize a screenshot to exact App Store dimensions
 *
 * Uses "cover" to fill the target dimensions and center-crops
 * to avoid stretching. Output is PNG with no compression artifacts.
 */
async function resizeForSubmission(inputPath, outputPath, targetSize) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const { width, height } = APP_STORE_SIZES[targetSize] || APP_STORE_SIZES['6.9inch'];

  await sharp(inputPath)
    .resize(width, height, {
      fit: 'cover',
      position: 'top', // Keep top of screen (status bar) visible
    })
    .png({ quality: 100, compressionLevel: 6 })
    .toFile(outputPath);

  return outputPath;
}

/**
 * Generate submission screenshots for all sizes
 *
 * @param {Array<{size: string, name: string, path: string}>} rawScreenshots
 * @param {string} outputDir - Base output directory
 * @param {string[]} sizes - Target sizes to generate (e.g., ['6.9inch', '6.5inch'])
 * @returns {Array<{size: string, name: string, path: string}>}
 */
async function generateSubmissionScreenshots(rawScreenshots, outputDir, sizes) {
  const results = [];

  for (const size of sizes) {
    const sizeConfig = APP_STORE_SIZES[size];
    if (!sizeConfig) {
      console.warn(`  Unknown size: ${size}, skipping`);
      continue;
    }

    const sizeDir = path.join(outputDir, 'submission', size);

    // For each raw screenshot, create a submission version at this size
    // Use raw screenshots from any captured size (they all need resizing anyway)
    const uniqueScreens = [];
    const seenNames = new Set();
    for (const ss of rawScreenshots) {
      if (!seenNames.has(ss.name)) {
        seenNames.add(ss.name);
        uniqueScreens.push(ss);
      }
    }

    for (const screenshot of uniqueScreens) {
      const filename = path.basename(screenshot.path);
      const outputPath = path.join(sizeDir, filename);

      console.log(`  Resizing ${screenshot.name} → ${size} (${sizeConfig.width}x${sizeConfig.height})`);
      await resizeForSubmission(screenshot.path, outputPath, size);

      results.push({
        size,
        name: screenshot.name,
        path: outputPath,
        dimensions: `${sizeConfig.width}x${sizeConfig.height}`,
      });
    }
  }

  return results;
}

/**
 * Verify screenshot dimensions match App Store requirements
 */
async function verifyDimensions(screenshotPath, expectedSize) {
  const metadata = await sharp(screenshotPath).metadata();
  const expected = APP_STORE_SIZES[expectedSize];

  if (!expected) return { valid: false, error: `Unknown size: ${expectedSize}` };

  const valid = metadata.width === expected.width && metadata.height === expected.height;

  return {
    valid,
    actual: { width: metadata.width, height: metadata.height },
    expected: { width: expected.width, height: expected.height },
    error: valid ? null : `Expected ${expected.width}x${expected.height}, got ${metadata.width}x${metadata.height}`,
  };
}

module.exports = {
  generateSubmissionScreenshots,
  resizeForSubmission,
  verifyDimensions,
  APP_STORE_SIZES,
};
