/**
 * iOS Simulator automation module
 *
 * Handles: booting simulator, building Xcode project, installing app,
 * capturing screenshots, and cleanup.
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Device configs mapped to App Store screenshot sizes
const DEVICE_CONFIGS = {
  '6.9inch': {
    // Prefer iPhone 17 Pro Max, iPhone 16 Pro Max, or iPhone 15 Pro Max
    namePatterns: ['iPhone 17 Pro Max', 'iPhone 16 Pro Max', 'iPhone 15 Pro Max'],
    width: 1320,
    height: 2868,
  },
  '6.5inch': {
    // Prefer iPhone 11 Pro Max, or fall back to similar-sized devices
    namePatterns: ['iPhone 11 Pro Max', 'iPhone 16e', 'iPhone SE'],
    width: 1242,
    height: 2688,
  },
};

/**
 * Find a matching simulator device by name patterns
 */
function findDevice(namePatterns) {
  const output = execSync('xcrun simctl list devices available -j', { encoding: 'utf-8' });
  const data = JSON.parse(output);

  for (const pattern of namePatterns) {
    for (const [runtime, devices] of Object.entries(data.devices)) {
      for (const device of devices) {
        if (device.name === pattern && device.isAvailable) {
          return { udid: device.udid, name: device.name, runtime };
        }
      }
    }
  }

  // If no exact match, find any available iPhone
  for (const [runtime, devices] of Object.entries(data.devices)) {
    for (const device of devices) {
      if (device.name.includes('iPhone') && device.isAvailable && device.name.includes('Pro Max')) {
        return { udid: device.udid, name: device.name, runtime };
      }
    }
  }

  return null;
}

/**
 * Boot a simulator device
 */
function bootSimulator(udid) {
  try {
    const statusOutput = execSync(`xcrun simctl list devices -j`, { encoding: 'utf-8' });
    const data = JSON.parse(statusOutput);

    // Check if already booted
    for (const devices of Object.values(data.devices)) {
      for (const d of devices) {
        if (d.udid === udid && d.state === 'Booted') {
          console.log(`  Simulator already booted: ${d.name}`);
          return;
        }
      }
    }

    console.log(`  Booting simulator ${udid}...`);
    execSync(`xcrun simctl boot "${udid}"`, { encoding: 'utf-8' });

    // Wait for boot to complete
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const status = execSync(`xcrun simctl spawn "${udid}" launchctl print system`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        ready = true;
        break;
      } catch {
        spawnSync('sleep', ['2']);
      }
    }

    if (!ready) {
      throw new Error('Simulator failed to boot within 60 seconds');
    }

    console.log('  Simulator booted successfully');
  } catch (err) {
    if (err.message && err.message.includes('already booted')) {
      console.log('  Simulator already booted');
      return;
    }
    throw err;
  }
}

/**
 * Find the Xcode project or workspace in a directory
 */
function findXcodeProject(projectPath) {
  const entries = fs.readdirSync(projectPath);

  // Prefer workspace over project
  const workspace = entries.find((e) => e.endsWith('.xcworkspace'));
  if (workspace) {
    return { type: 'workspace', path: path.join(projectPath, workspace), name: workspace.replace('.xcworkspace', '') };
  }

  const xcodeproj = entries.find((e) => e.endsWith('.xcodeproj'));
  if (xcodeproj) {
    return { type: 'project', path: path.join(projectPath, xcodeproj), name: xcodeproj.replace('.xcodeproj', '') };
  }

  // Check for iOS subfolder (common in React Native / Expo projects)
  const iosDir = path.join(projectPath, 'ios');
  if (fs.existsSync(iosDir)) {
    return findXcodeProject(iosDir);
  }

  return null;
}

/**
 * Find available schemes for a project
 */
function findSchemes(xcodeProject) {
  try {
    const flag = xcodeProject.type === 'workspace' ? '-workspace' : '-project';
    const output = execSync(
      `xcodebuild ${flag} "${xcodeProject.path}" -list -json 2>/dev/null`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    const data = JSON.parse(output);
    const key = xcodeProject.type === 'workspace' ? 'workspace' : 'project';
    return data[key]?.schemes || [];
  } catch {
    return [xcodeProject.name];
  }
}

/**
 * Pick the best scheme (prefer app over test/clip targets)
 */
function pickScheme(schemes, projectName) {
  // Exact project name match
  if (schemes.includes(projectName)) return projectName;

  // Filter out test, clip, extension, and widget schemes
  const appSchemes = schemes.filter(
    (s) =>
      !s.toLowerCase().includes('test') &&
      !s.toLowerCase().includes('clip') &&
      !s.toLowerCase().includes('extension') &&
      !s.toLowerCase().includes('widget') &&
      !s.toLowerCase().includes('watch')
  );

  return appSchemes[0] || schemes[0];
}

/**
 * Build and install app on simulator
 */
function buildAndInstall(xcodeProject, scheme, deviceUdid, deviceName) {
  const flag = xcodeProject.type === 'workspace' ? '-workspace' : '-project';
  const derivedData = '/tmp/ios-screenshot-gen-build';

  console.log(`  Building scheme "${scheme}" for ${deviceName}...`);

  const buildCmd = [
    'xcodebuild',
    flag, `"${xcodeProject.path}"`,
    '-scheme', `"${scheme}"`,
    '-configuration', 'Debug',
    `-destination 'platform=iOS Simulator,id=${deviceUdid}'`,
    `-derivedDataPath "${derivedData}"`,
    'build',
    '2>&1',
  ].join(' ');

  try {
    execSync(buildCmd, {
      encoding: 'utf-8',
      timeout: 600000, // 10 min
      shell: '/bin/bash',
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
    const output = err.stdout || err.stderr || '';
    // Extract the actual error lines
    const errorLines = output.split('\n').filter((l) => l.includes('error:'));
    const errorMsg = errorLines.slice(0, 5).join('\n') || 'Build failed (check Xcode logs)';
    throw new Error(`Build failed:\n${errorMsg}`);
  }

  // Find the .app bundle
  const productsDir = path.join(derivedData, 'Build', 'Products', 'Debug-iphonesimulator');
  if (!fs.existsSync(productsDir)) {
    throw new Error(`Build products not found at ${productsDir}`);
  }

  const apps = fs.readdirSync(productsDir).filter((f) => f.endsWith('.app'));
  if (apps.length === 0) {
    throw new Error('No .app bundle found in build products');
  }

  const appPath = path.join(productsDir, apps[0]);
  console.log(`  Installing ${apps[0]}...`);

  execSync(`xcrun simctl install "${deviceUdid}" "${appPath}"`, { encoding: 'utf-8' });

  // Extract bundle ID from the app
  const infoPlistPath = path.join(appPath, 'Info.plist');
  let bundleId;
  try {
    bundleId = execSync(`/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "${infoPlistPath}"`, {
      encoding: 'utf-8',
    }).trim();
  } catch {
    // Try reading from pbxproj
    bundleId = scheme.toLowerCase().replace(/\s+/g, '.');
  }

  return { appPath, bundleId };
}

/**
 * Launch app and wait for it to be ready
 */
function launchApp(deviceUdid, bundleId) {
  console.log(`  Launching ${bundleId}...`);
  try {
    execSync(`xcrun simctl launch "${deviceUdid}" "${bundleId}"`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`Failed to launch app: ${err.message}`);
  }

  // Wait for app to settle (load UI)
  console.log('  Waiting for app to settle...');
  spawnSync('sleep', ['3']);
}

/**
 * Capture screenshot from simulator
 */
function captureScreenshot(deviceUdid, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  execSync(`xcrun simctl io "${deviceUdid}" screenshot "${outputPath}"`, { encoding: 'utf-8' });

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Screenshot not saved: ${outputPath}`);
  }

  return outputPath;
}

/**
 * Uninstall app from simulator
 */
function uninstallApp(deviceUdid, bundleId) {
  try {
    execSync(`xcrun simctl uninstall "${deviceUdid}" "${bundleId}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('  App uninstalled');
  } catch {
    // Ignore uninstall errors
  }
}

/**
 * Shutdown simulator
 */
function shutdownSimulator(deviceUdid) {
  try {
    execSync(`xcrun simctl shutdown "${deviceUdid}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('  Simulator shut down');
  } catch {
    // Ignore
  }
}

/**
 * Main function: capture screenshots from an iOS project
 *
 * @param {string} projectPath - Path to iOS project
 * @param {object} options - { sizes, screens, outputDir, scheme }
 * @returns {{ screenshots: Array<{size: string, name: string, path: string}>, bundleId: string }}
 */
async function captureFromProject(projectPath, options = {}) {
  const sizes = options.sizes || ['6.9inch'];
  const screenNames = options.screens || ['main'];
  const outputDir = options.outputDir || '/tmp/ios-screenshot-gen/captures';
  const waitTime = options.waitTime || 3;

  // Find Xcode project
  const xcodeProject = findXcodeProject(projectPath);
  if (!xcodeProject) {
    throw new Error(`No Xcode project or workspace found in ${projectPath}`);
  }
  console.log(`  Found: ${xcodeProject.type} at ${xcodeProject.path}`);

  // Find and pick scheme
  const schemes = findSchemes(xcodeProject);
  const scheme = options.scheme || pickScheme(schemes, xcodeProject.name);
  console.log(`  Using scheme: ${scheme}`);

  const screenshots = [];

  for (const size of sizes) {
    const deviceConfig = DEVICE_CONFIGS[size];
    if (!deviceConfig) {
      console.warn(`  Unknown size: ${size}, skipping`);
      continue;
    }

    // Find matching device
    const device = findDevice(deviceConfig.namePatterns);
    if (!device) {
      console.warn(`  No simulator found for ${size}, skipping`);
      continue;
    }
    console.log(`\n  Using device: ${device.name} (${device.udid}) for ${size}`);

    // Boot simulator
    bootSimulator(device.udid);

    // Build and install
    const { bundleId } = buildAndInstall(xcodeProject, scheme, device.udid, device.name);

    // Launch app
    launchApp(device.udid, bundleId);

    // Capture screenshots for each screen
    for (let i = 0; i < screenNames.length; i++) {
      const screenName = screenNames[i];
      const filename = `${String(i + 1).padStart(2, '0')}-${screenName}.png`;
      const screenshotPath = path.join(outputDir, size, filename);

      if (i > 0 && options.deepLinks && options.deepLinks[screenName]) {
        // Navigate to screen via deep link
        try {
          execSync(
            `xcrun simctl openurl "${device.udid}" "${options.deepLinks[screenName]}"`,
            { encoding: 'utf-8' }
          );
          spawnSync('sleep', [String(waitTime)]);
        } catch {
          console.warn(`  Failed to open deep link for ${screenName}`);
        }
      }

      console.log(`  Capturing ${screenName}...`);
      captureScreenshot(device.udid, screenshotPath);

      screenshots.push({ size, name: screenName, path: screenshotPath });
    }

    // Cleanup
    uninstallApp(device.udid, bundleId);
  }

  return { screenshots, xcodeProject };
}

module.exports = {
  captureFromProject,
  findXcodeProject,
  findDevice,
  bootSimulator,
  captureScreenshot,
  shutdownSimulator,
  DEVICE_CONFIGS,
};
