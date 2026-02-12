# ios-screenshot-gen

CLI tool that generates App Store screenshots from any iOS project. Point it at an Xcode project, and it builds the app in iOS Simulator, captures screenshots, and produces two types of output:

1. **Submission screenshots** — resized to exact App Store dimensions, ready for App Store Connect
2. **Display screenshots** — marketing images with device frames, gradient backgrounds, and text overlays

## Install

```bash
git clone https://github.com/swapp1990/ios-screenshot-gen.git
cd ios-screenshot-gen
npm install
npm link  # makes `ios-screenshot-gen` available globally
```

**Requirements:** macOS with Xcode and iOS Simulator installed, Node.js 18+.

## Quick Start

```bash
# Generate screenshots for any iOS project
ios-screenshot-gen ~/projects/MyApp --output ~/screenshots

# Both 6.9" and 6.5" sizes (default)
ios-screenshot-gen ~/projects/MyApp --sizes 6.9inch,6.5inch

# With custom marketing text via config file
ios-screenshot-gen ~/projects/MyApp --config screenshots.json

# Skip simulator build (reuse previously captured screenshots)
ios-screenshot-gen ~/projects/MyApp --skip-build --output ~/screenshots
```

## Tutorial: Generating Screenshots for Quest Planner

This walkthrough uses the Quest Planner iOS app as a real example.

### Step 1: Basic run (single screenshot)

```bash
ios-screenshot-gen ~/projects/ios_projects/quest-planner \
  --output ~/screenshots/quest-planner \
  --sizes 6.9inch
```

What happens:
- Tool finds the `.xcworkspace` in the `ios/` directory
- Picks the `QuestPlanner` scheme automatically
- Boots iPhone 17 Pro Max simulator
- Builds and installs the app (~3 min first time)
- Waits for app to settle, captures the main screen
- Generates submission screenshot at 1320x2868
- Generates display screenshot with device frame + gradient
- Uninstalls the app from simulator

Output:
```
~/screenshots/quest-planner/
├── submission/
│   └── 6.9inch/
│       └── 01-main.png          # 1320x2868, plain screenshot
└── display/
    └── 01-main-hero.png         # 1320x2868, with device frame + gradient + "Quest Planner" headline
```

### Step 2: Both App Store sizes

```bash
ios-screenshot-gen ~/projects/ios_projects/quest-planner \
  --output ~/screenshots/quest-planner \
  --sizes 6.9inch,6.5inch
```

Output adds 6.5" versions:
```
~/screenshots/quest-planner/
├── submission/
│   ├── 6.9inch/
│   │   └── 01-main.png          # 1320x2868
│   └── 6.5inch/
│       └── 01-main.png          # 1242x2688
└── display/
    └── 01-main-hero.png
```

### Step 3: Custom marketing text with a config file

Create `quest-planner-screenshots.json`:

```json
{
  "screens": ["main"],
  "headlines": ["Plan your quest"],
  "subtexts": ["Gamify your goals"],
  "gradients": [["#6366F1", "#EC4899"]]
}
```

Run with the config:

```bash
ios-screenshot-gen ~/projects/ios_projects/quest-planner \
  --config quest-planner-screenshots.json \
  --output ~/screenshots/quest-planner \
  --sizes 6.9inch,6.5inch
```

The display screenshot now uses "Plan your quest" as the headline, "Gamify your goals" as subtext, and a purple-to-pink gradient background.

### Step 4: Iterate quickly with --skip-build

After the first run, your simulator screenshots are cached in `/tmp/ios-screenshot-gen/captures/`. Use `--skip-build` to regenerate submission and display screenshots without rebuilding:

```bash
# Change the config, tweak headlines/colors, re-run instantly
ios-screenshot-gen ~/projects/ios_projects/quest-planner \
  --config quest-planner-screenshots.json \
  --skip-build \
  --output ~/screenshots/quest-planner
```

This takes under 1 second since it skips the simulator entirely.

### Step 5: Multiple screens (with deep links)

If your app supports URL schemes, you can capture multiple screens:

```json
{
  "screens": ["main", "detail", "settings"],
  "headlines": ["Plan your quest", "Track every step", "Make it yours"],
  "subtexts": ["Gamify your goals", null, null],
  "gradients": [
    ["#6366F1", "#EC4899"],
    ["#3B82F6", "#10B981"],
    ["#F59E0B", "#EF4444"]
  ],
  "deepLinks": {
    "detail": "questplanner://campaign/1",
    "settings": "questplanner://settings"
  },
  "waitTime": 5
}
```

## Output Dimensions

| Size | Dimensions | Device |
|------|-----------|--------|
| 6.9inch | 1320 x 2868 | iPhone 15/16/17 Pro Max |
| 6.5inch | 1242 x 2688 | iPhone 11 Pro Max |

These are the exact pixel dimensions required by App Store Connect.

## CLI Options

```
Usage: ios-screenshot-gen [options] <project-path>

Arguments:
  project-path         Path to iOS project directory

Options:
  -o, --output <dir>   Output directory (default: "./screenshots")
  -c, --config <file>  JSON configuration file
  -s, --sizes <sizes>  Screenshot sizes, comma-separated (default: "6.9inch,6.5inch")
  --scheme <name>      Xcode scheme to build (auto-detected if not specified)
  --screens <names>    Screen names to capture, comma-separated (default: "main")
  --skip-build         Skip simulator build, reuse cached screenshots
  --skip-display       Only generate submission screenshots
  --skip-submission    Only generate display screenshots
  --no-cleanup         Keep app installed after capture
  -h, --help           Show help
  -V, --version        Show version
```

## Config File Reference

All fields are optional. The tool works without a config file using sensible defaults.

```json
{
  "screens": ["main", "detail"],
  "headlines": ["Your headline", "Second headline"],
  "subtexts": ["Optional subtext", null],
  "gradients": [["#color1", "#color2"], ["#color3", "#color4"]],
  "textPositions": ["top", "bottom"],
  "deepLinks": {
    "detail": "myapp://screen/detail"
  },
  "waitTime": 5
}
```

| Field | Type | Description |
|-------|------|-------------|
| `screens` | string[] | Screen names to capture |
| `headlines` | string[] | Marketing headline per screen |
| `subtexts` | string[] | Secondary text per screen (null to skip) |
| `gradients` | string[][] | Gradient color pairs per screen |
| `textPositions` | string[] | "top" or "bottom" per screen |
| `deepLinks` | object | URL scheme per screen name (for navigation) |
| `waitTime` | number | Seconds to wait after navigation (default: 3) |

## How It Works

1. **Metadata extraction** — reads app name, bundle ID, and accent color from Info.plist and Assets.xcassets
2. **Simulator automation** — boots simulator, builds via `xcodebuild`, installs and launches app via `xcrun simctl`
3. **Screen capture** — captures screenshots via `xcrun simctl io screenshot`
4. **Submission generation** — resizes raw screenshots to exact App Store dimensions using sharp
5. **Display generation** — composites device frame (rounded corners + metallic bezel), gradient background, and text overlay using sharp SVG rendering

## Architecture

```
src/
├── cli.js          # CLI entry point (commander)
├── simulator.js    # iOS Simulator automation (xcrun simctl, xcodebuild)
├── metadata.js     # Xcode project metadata extraction
├── submission.js   # Submission screenshot resizer
└── compositor.js   # Display screenshot compositor (frames, gradients, text)
```

Dependencies: `sharp` (image processing) and `commander` (CLI parsing). No Puppeteer or browser needed.

## License

MIT
