#!/usr/bin/env node

/**
 * ios-screenshot-gen CLI
 *
 * Generate App Store screenshots from any iOS project.
 *
 * Usage:
 *   ios-screenshot-gen <project-path> [options]
 *   ios-screenshot-gen ~/projects/MyApp --output ~/screenshots
 *   ios-screenshot-gen ~/projects/MyApp --config screenshots.json
 */

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const { captureFromProject, shutdownSimulator, findDevice, DEVICE_CONFIGS } = require('./simulator');
const { extractMetadata } = require('./metadata');
const { generateSubmissionScreenshots, verifyDimensions, APP_STORE_SIZES } = require('./submission');
const { generateDisplayScreenshots } = require('./compositor');

const pkg = require('../package.json');

const program = new Command();

program
  .name('ios-screenshot-gen')
  .description('Generate App Store screenshots from any iOS project')
  .version(pkg.version)
  .argument('<project-path>', 'Path to iOS project directory')
  .option('-o, --output <dir>', 'Output directory', './screenshots')
  .option('-c, --config <file>', 'JSON configuration file')
  .option('-s, --sizes <sizes>', 'Screenshot sizes (comma-separated)', '6.9inch,6.5inch')
  .option('--scheme <name>', 'Xcode scheme to build')
  .option('--screens <names>', 'Screen names to capture (comma-separated)', 'main')
  .option('--skip-build', 'Skip build, use existing simulator screenshots')
  .option('--skip-display', 'Skip display screenshot generation')
  .option('--skip-submission', 'Skip submission screenshot generation')
  .option('--no-cleanup', 'Do not uninstall app or shutdown simulator after capture')
  .action(run);

program.parse();

async function run(projectPath, options) {
  const startTime = Date.now();

  console.log('\n========================================');
  console.log('  iOS Screenshot Generator');
  console.log('========================================\n');

  // Resolve project path
  projectPath = path.resolve(projectPath.replace(/^~/, process.env.HOME));
  if (!fs.existsSync(projectPath)) {
    console.error(`Error: Project not found: ${projectPath}`);
    process.exit(1);
  }
  console.log(`Project: ${projectPath}`);

  // Parse sizes
  const sizes = options.sizes.split(',').map((s) => s.trim());
  console.log(`Sizes: ${sizes.join(', ')}`);

  // Parse screens
  let screens = options.screens.split(',').map((s) => s.trim());

  // Load config file if provided
  let config = {};
  if (options.config) {
    const configPath = path.resolve(options.config);
    if (!fs.existsSync(configPath)) {
      console.error(`Error: Config file not found: ${configPath}`);
      process.exit(1);
    }
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      console.error(`Error: Invalid config file: ${err.message}`);
      process.exit(1);
    }
    console.log(`Config: ${configPath}`);

    // Override screens from config
    if (config.screens && Array.isArray(config.screens)) {
      screens = config.screens;
    }
  }

  // Resolve output directory
  const outputDir = path.resolve(options.output.replace(/^~/, process.env.HOME));
  console.log(`Output: ${outputDir}\n`);

  try {
    // Step 1: Extract metadata
    console.log('Step 1: Extracting project metadata...');
    const metadata = extractMetadata(projectPath);
    console.log();

    // Step 2: Capture screenshots from simulator
    let rawScreenshots = [];

    if (options.skipBuild) {
      console.log('Step 2: Skipping build (--skip-build)');
      // Look for existing captures in temp dir
      const captureDir = '/tmp/ios-screenshot-gen/captures';
      if (fs.existsSync(captureDir)) {
        for (const size of sizes) {
          const sizeDir = path.join(captureDir, size);
          if (!fs.existsSync(sizeDir)) continue;
          const files = fs.readdirSync(sizeDir).filter((f) => f.endsWith('.png'));
          for (const file of files) {
            const name = file.replace(/^\d+-/, '').replace('.png', '');
            rawScreenshots.push({ size, name, path: path.join(sizeDir, file) });
          }
        }
      }
      if (rawScreenshots.length === 0) {
        console.error('Error: No existing screenshots found. Remove --skip-build to capture new ones.');
        process.exit(1);
      }
      console.log(`  Found ${rawScreenshots.length} existing screenshot(s)\n`);
    } else {
      console.log('Step 2: Capturing screenshots from simulator...');
      const captureResult = await captureFromProject(projectPath, {
        sizes,
        screens,
        outputDir: '/tmp/ios-screenshot-gen/captures',
        scheme: options.scheme,
        deepLinks: config.deepLinks || {},
        waitTime: config.waitTime || 3,
      });
      rawScreenshots = captureResult.screenshots;
      console.log(`\n  Captured ${rawScreenshots.length} screenshot(s)\n`);
    }

    if (rawScreenshots.length === 0) {
      console.error('Error: No screenshots captured. Check that the app builds and launches successfully.');
      process.exit(1);
    }

    // Step 3: Generate submission screenshots
    let submissionResults = [];
    if (!options.skipSubmission) {
      console.log('Step 3: Generating submission screenshots...');
      submissionResults = await generateSubmissionScreenshots(rawScreenshots, outputDir, sizes);

      // Verify dimensions
      for (const ss of submissionResults) {
        const verification = await verifyDimensions(ss.path, ss.size);
        if (!verification.valid) {
          console.warn(`  Warning: ${ss.path} has wrong dimensions: ${verification.error}`);
        }
      }
      console.log(`  Generated ${submissionResults.length} submission screenshot(s)\n`);
    } else {
      console.log('Step 3: Skipping submission (--skip-submission)\n');
    }

    // Step 4: Generate display screenshots
    let displayResults = [];
    if (!options.skipDisplay) {
      console.log('Step 4: Generating display screenshots...');

      // Build display config from config file
      const displayConfig = {};
      if (config.headlines) {
        // Map headlines array to screen configs
        screens.forEach((screen, i) => {
          displayConfig[screen] = {
            headline: config.headlines[i] || metadata.appName,
            subtext: config.subtexts ? config.subtexts[i] : null,
            background: config.gradients
              ? { type: 'gradient', colors: config.gradients[i] || [metadata.primaryColor, metadata.accentColor] }
              : undefined,
            textPosition: config.textPositions ? config.textPositions[i] : undefined,
          };
        });
      }

      displayResults = await generateDisplayScreenshots(rawScreenshots, metadata, outputDir, displayConfig);
      console.log(`  Generated ${displayResults.length} display screenshot(s)\n`);
    } else {
      console.log('Step 4: Skipping display (--skip-display)\n');
    }

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('========================================');
    console.log('  Summary');
    console.log('========================================\n');
    console.log(`  App: ${metadata.appName}`);
    console.log(`  Generated ${submissionResults.length} submission + ${displayResults.length} display screenshots`);
    console.log(`  Output: ${outputDir}`);

    if (submissionResults.length > 0) {
      console.log('\n  Submission screenshots:');
      for (const ss of submissionResults) {
        console.log(`    ${ss.dimensions} → ${path.relative(outputDir, ss.path)}`);
      }
    }

    if (displayResults.length > 0) {
      console.log('\n  Display screenshots:');
      for (const ds of displayResults) {
        console.log(`    → ${path.relative(outputDir, ds.path)}`);
      }
    }

    console.log(`\n  Time: ${elapsed}s\n`);

    process.exit(0);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}
