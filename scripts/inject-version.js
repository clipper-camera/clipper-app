#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Script to automatically sync the version from app.json across all files
 * Updates: updateService.ts and package.json
 * This ensures all version numbers are always in sync without manual updates
 */

function injectVersion() {
  try {
    // Read app.json
    const appJsonPath = path.join(__dirname, '..', 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    const version = appJson.expo.version;

    if (!version) {
      throw new Error('Version not found in app.json');
    }

    console.log(`Syncing version ${version} across all files...`);

    // Update updateService.ts
    const updateServicePath = path.join(__dirname, '..', 'src', 'services', 'updateService.ts');
    let updateServiceContent = fs.readFileSync(updateServicePath, 'utf8');

    const versionRegex = /this\.currentVersion = '[^']*';/;
    const newVersionLine = `this.currentVersion = '${version}';`;
    
    if (versionRegex.test(updateServiceContent)) {
      updateServiceContent = updateServiceContent.replace(versionRegex, newVersionLine);
      fs.writeFileSync(updateServicePath, updateServiceContent, 'utf8');
      console.log(`✅ Updated version to ${version} in updateService.ts`);
    } else {
      console.warn('⚠️  Could not find version line to replace in updateService.ts');
    }

    // Update package.json
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    if (packageJson.version !== version) {
      packageJson.version = version;
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
      console.log(`✅ Updated version to ${version} in package.json`);
    } else {
      console.log(`✅ package.json already has version ${version}`);
    }

    console.log(`🎉 All files are now synced with version ${version}`);

  } catch (error) {
    console.error('❌ Error syncing version:', error.message);
    process.exit(1);
  }
}

// Run the script
injectVersion();
