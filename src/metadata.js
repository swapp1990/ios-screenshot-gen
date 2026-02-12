/**
 * iOS project metadata extraction module
 *
 * Extracts: app name, bundle ID, primary color, app icon
 * from Xcode project files (Info.plist, Assets.xcassets, .pbxproj)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  appName: 'My App',
  bundleId: 'com.example.app',
  primaryColor: '#3B82F6', // Blue
  accentColor: '#8B5CF6', // Purple
};

/**
 * Find Info.plist files in a project
 */
function findInfoPlists(projectPath) {
  const results = [];

  function walk(dir, depth = 0) {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'build' || entry.name === 'Pods') continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.name === 'Info.plist') {
          results.push(fullPath);
        }
      }
    } catch {
      // Permission or access error
    }
  }

  walk(projectPath);
  return results;
}

/**
 * Read a value from a plist file using PlistBuddy
 */
function readPlistValue(plistPath, key) {
  try {
    return execSync(
      `/usr/libexec/PlistBuddy -c "Print :${key}" "${plistPath}" 2>/dev/null`,
      { encoding: 'utf-8' }
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Extract app display name from Info.plist
 */
function extractAppName(projectPath) {
  const plists = findInfoPlists(projectPath);

  for (const plist of plists) {
    // Skip test/extension plists
    if (plist.includes('Test') || plist.includes('Extension') || plist.includes('Widget') || plist.includes('Clip')) {
      continue;
    }

    // Try CFBundleDisplayName first, then CFBundleName
    const displayName = readPlistValue(plist, 'CFBundleDisplayName');
    if (displayName && !displayName.startsWith('$(')) return displayName;

    const bundleName = readPlistValue(plist, 'CFBundleName');
    if (bundleName && !bundleName.startsWith('$(')) return bundleName;
  }

  // Try reading from .pbxproj for PRODUCT_NAME
  const pbxproj = findPbxproj(projectPath);
  if (pbxproj) {
    try {
      const content = fs.readFileSync(pbxproj, 'utf-8');
      const match = content.match(/PRODUCT_NAME\s*=\s*"?([^";\n]+)"?/);
      if (match) return match[1].trim();
    } catch {
      // Ignore
    }
  }

  return DEFAULTS.appName;
}

/**
 * Find .pbxproj file
 */
function findPbxproj(projectPath) {
  function walk(dir, depth = 0) {
    if (depth > 3) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'Pods') continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name.endsWith('.xcodeproj')) {
            const pbx = path.join(fullPath, 'project.pbxproj');
            if (fs.existsSync(pbx)) return pbx;
          }
          const result = walk(fullPath, depth + 1);
          if (result) return result;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }

  return walk(projectPath);
}

/**
 * Extract bundle identifier from project
 */
function extractBundleId(projectPath) {
  // Try from Info.plist
  const plists = findInfoPlists(projectPath);
  for (const plist of plists) {
    if (plist.includes('Test') || plist.includes('Extension')) continue;
    const bundleId = readPlistValue(plist, 'CFBundleIdentifier');
    if (bundleId && !bundleId.startsWith('$(')) return bundleId;
  }

  // Try from .pbxproj
  const pbxproj = findPbxproj(projectPath);
  if (pbxproj) {
    try {
      const content = fs.readFileSync(pbxproj, 'utf-8');
      const match = content.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";\n]+)"?/);
      if (match) return match[1].trim();
    } catch {
      // Ignore
    }
  }

  return DEFAULTS.bundleId;
}

/**
 * Find Assets.xcassets directory
 */
function findAssetsDir(projectPath) {
  function walk(dir, depth = 0) {
    if (depth > 5) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'Pods' || entry.name === '.git') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'Assets.xcassets') return fullPath;
          const result = walk(fullPath, depth + 1);
          if (result) return result;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }
  return walk(projectPath);
}

/**
 * Extract primary/accent color from Assets.xcassets
 */
function extractPrimaryColor(projectPath) {
  const assetsDir = findAssetsDir(projectPath);
  if (!assetsDir) return DEFAULTS.primaryColor;

  // Look for AccentColor.colorset
  const colorNames = ['AccentColor', 'PrimaryColor', 'BrandColor'];

  for (const name of colorNames) {
    const colorsetDir = path.join(assetsDir, `${name}.colorset`);
    if (!fs.existsSync(colorsetDir)) continue;

    const contentsPath = path.join(colorsetDir, 'Contents.json');
    if (!fs.existsSync(contentsPath)) continue;

    try {
      const contents = JSON.parse(fs.readFileSync(contentsPath, 'utf-8'));
      const colors = contents.colors;
      if (!colors || colors.length === 0) continue;

      // Look for universal or light appearance color
      const colorEntry = colors.find((c) => !c.appearances) || colors[0];
      const color = colorEntry?.color;

      if (color?.components) {
        const r = parseColorComponent(color.components.red);
        const g = parseColorComponent(color.components.green);
        const b = parseColorComponent(color.components.blue);
        return rgbToHex(r, g, b);
      }
    } catch {
      // Ignore parse errors
    }
  }

  return DEFAULTS.primaryColor;
}

/**
 * Parse a color component (could be "0.123" float or "31" integer 0-255)
 */
function parseColorComponent(value) {
  if (typeof value === 'string') {
    const num = parseFloat(value);
    if (num <= 1.0 && value.includes('.')) {
      return Math.round(num * 255);
    }
    return Math.round(num);
  }
  return typeof value === 'number' ? Math.round(value > 1 ? value : value * 255) : 0;
}

/**
 * Convert RGB to hex
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((c) => Math.min(255, Math.max(0, c)).toString(16).padStart(2, '0')).join('');
}

/**
 * Find app icon in Assets.xcassets
 */
function extractAppIcon(projectPath) {
  const assetsDir = findAssetsDir(projectPath);
  if (!assetsDir) return null;

  const iconDir = path.join(assetsDir, 'AppIcon.appiconset');
  if (!fs.existsSync(iconDir)) return null;

  const contentsPath = path.join(iconDir, 'Contents.json');
  if (!fs.existsSync(contentsPath)) return null;

  try {
    const contents = JSON.parse(fs.readFileSync(contentsPath, 'utf-8'));
    const images = contents.images || [];

    // Prefer largest available icon
    const sorted = images
      .filter((img) => img.filename && fs.existsSync(path.join(iconDir, img.filename)))
      .sort((a, b) => {
        const sizeA = parseFloat(a.size || '0');
        const sizeB = parseFloat(b.size || '0');
        return sizeB - sizeA;
      });

    if (sorted.length > 0) {
      return path.join(iconDir, sorted[0].filename);
    }
  } catch {
    // Ignore
  }

  // Fallback: look for any PNG in the iconset
  try {
    const files = fs.readdirSync(iconDir).filter((f) => f.endsWith('.png'));
    if (files.length > 0) return path.join(iconDir, files[0]);
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Extract all metadata from an iOS project
 *
 * @param {string} projectPath
 * @returns {{ appName: string, bundleId: string, primaryColor: string, accentColor: string, appIcon: string|null }}
 */
function extractMetadata(projectPath) {
  console.log('  Extracting project metadata...');

  const appName = extractAppName(projectPath);
  const bundleId = extractBundleId(projectPath);
  const primaryColor = extractPrimaryColor(projectPath);
  const appIcon = extractAppIcon(projectPath);

  // Derive a complementary accent color
  const accentColor = deriveAccentColor(primaryColor);

  const metadata = { appName, bundleId, primaryColor, accentColor, appIcon };

  console.log(`    App name: ${appName}`);
  console.log(`    Bundle ID: ${bundleId}`);
  console.log(`    Primary color: ${primaryColor}`);
  console.log(`    App icon: ${appIcon ? 'found' : 'not found'}`);

  return metadata;
}

/**
 * Derive a lighter/complementary accent color from primary
 */
function deriveAccentColor(hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  // Shift hue slightly and lighten
  const lighten = (c) => Math.min(255, c + 60);
  return rgbToHex(lighten(r), lighten(g), lighten(b));
}

module.exports = {
  extractMetadata,
  extractAppName,
  extractBundleId,
  extractPrimaryColor,
  extractAppIcon,
  DEFAULTS,
};
