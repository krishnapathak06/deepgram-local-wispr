const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIST_APP = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const OUTPUT_APP = path.join(DIST_DIR, 'Wispr Studio.app');
const APPLICATIONS_APP = '/Applications/Wispr Studio.app';
const ICON_PATH = path.join(PROJECT_ROOT, 'assets', 'AppIcon.icns');

console.log('🚀 Building standalone macOS application: Wispr Studio.app...');

if (!fs.existsSync(ELECTRON_DIST_APP)) {
  console.error('❌ Error: Electron app not found at', ELECTRON_DIST_APP);
  process.exit(1);
}

// 1. Prepare dist directory
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 2. Copy Electron.app template
console.log('📦 Copying base Electron runtime bundle...');
execSync(`cp -R "${ELECTRON_DIST_APP}" "${OUTPUT_APP}"`);

const contentsDir = path.join(OUTPUT_APP, 'Contents');
const macOSDir = path.join(contentsDir, 'MacOS');
const resourcesDir = path.join(contentsDir, 'Resources');
const appDir = path.join(resourcesDir, 'app');

// 3. Rename executable
console.log('⚙️ Configuring executable binary...');
const oldExec = path.join(macOSDir, 'Electron');
const newExec = path.join(macOSDir, 'Wispr Studio');
if (fs.existsSync(oldExec)) {
  fs.renameSync(oldExec, newExec);
}

// 4. Install App Icons
console.log('🎨 Applying custom application thumbnail icon...');
if (fs.existsSync(ICON_PATH)) {
  fs.copyFileSync(ICON_PATH, path.join(resourcesDir, 'AppIcon.icns'));
  fs.copyFileSync(ICON_PATH, path.join(resourcesDir, 'electron.icns'));
}

// 5. Update Info.plist
console.log('📝 Configuring Info.plist metadata & system permissions...');
const plistPath = path.join(contentsDir, 'Info.plist');
let plistContent = fs.readFileSync(plistPath, 'utf8');

// Replace identifiers and names
plistContent = plistContent
  .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/g, '<key>CFBundleDisplayName</key>\n\t<string>Wispr Studio</string>')
  .replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/g, '<key>CFBundleName</key>\n\t<string>Wispr Studio</string>')
  .replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/g, '<key>CFBundleExecutable</key>\n\t<string>Wispr Studio</string>')
  .replace(/<key>CFBundleIconFile<\/key>\s*<string>[^<]*<\/string>/g, '<key>CFBundleIconFile</key>\n\t<string>AppIcon.icns</string>');

// Inject Microphone & Accessibility privacy descriptions if not already present
if (!plistContent.includes('NSMicrophoneUsageDescription')) {
  plistContent = plistContent.replace('</dict>\n</plist>', `\t<key>NSMicrophoneUsageDescription</key>
\t<string>Wispr Studio requires microphone access for voice dictation and speech recognition.</string>
\t<key>NSAppleEventsUsageDescription</key>
\t<string>Wispr Studio requires accessibility to type transcribed speech at your active cursor.</string>
</dict>
</plist>`);
}

fs.writeFileSync(plistPath, plistContent, 'utf8');

// 6. Copy Application Source Code
console.log('📂 Packaging application code & assets...');
fs.mkdirSync(appDir, { recursive: true });

// Copy package.json
fs.copyFileSync(path.join(PROJECT_ROOT, 'package.json'), path.join(appDir, 'package.json'));

// Copy src directory
execSync(`cp -R "${path.join(PROJECT_ROOT, 'src')}" "${appDir}/"`);

// Copy assets
if (fs.existsSync(path.join(PROJECT_ROOT, 'assets'))) {
  execSync(`cp -R "${path.join(PROJECT_ROOT, 'assets')}" "${appDir}/"`);
}

// Copy .env.local if present
if (fs.existsSync(path.join(PROJECT_ROOT, '.env.local'))) {
  fs.copyFileSync(path.join(PROJECT_ROOT, '.env.local'), path.join(appDir, '.env.local'));
}

// 7. Install to /Applications
console.log(`📥 Installing to ${APPLICATIONS_APP}...`);
try {
  execSync(`rm -rf "${APPLICATIONS_APP}"`);
  execSync(`cp -R "${OUTPUT_APP}" "${APPLICATIONS_APP}"`);
  execSync(`touch "${APPLICATIONS_APP}"`);
  console.log('✅ Successfully installed to /Applications/Wispr Studio.app');
} catch (err) {
  console.warn('⚠️ Note: Could not write directly to /Applications (sandbox/permission). The standalone app is built in ./dist/Wispr Studio.app');
}

console.log('✨ Build complete!');
console.log(`📍 Standalone Application: ${OUTPUT_APP}`);
