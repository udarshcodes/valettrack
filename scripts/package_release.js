import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputPath = path.resolve(rootDir, 'valettrack-release.zip');

export function packageRelease() {
  console.log('=== ValetTrack Release Packaging & Hygiene Verification ===');

  // 1. Generate release archive using git archive to strictly package tracked source assets
  console.log('1. Packaging tracked repository sources via git archive...');
  if (fs.existsSync(outputPath)) {
    try {
      fs.unlinkSync(outputPath);
    } catch {}
  }

  let treeIsh = 'HEAD';
  try {
    const tree = execSync('git write-tree', { cwd: rootDir, encoding: 'utf-8' }).trim();
    if (tree && /^[0-9a-f]{40}$/i.test(tree)) {
      treeIsh = tree;
    }
  } catch {}

  try {
    execSync(`git archive --format=zip --output="${outputPath}" ${treeIsh}`, {
      cwd: rootDir,
      stdio: 'inherit'
    });
  } catch (err) {
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch {}
    }
    throw new Error(`Failed to generate release zip archive with git archive: ${err.message}`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('Failed to generate release zip archive: output file does not exist.');
  }

  try {
    // 2. Validate archive integrity using AdmZip
    console.log('2. Inspecting archive integrity and table of contents with AdmZip...');
    let zip;
    try {
      zip = new AdmZip(outputPath);
    } catch (err) {
      throw new Error(`Archive integrity failure: generated file is not a valid ZIP (${err.message}).`);
    }

    const zipEntries = zip.getEntries();
    if (!zipEntries || zipEntries.length === 0) {
      throw new Error('Archive integrity failure: generated release ZIP archive contains zero entries.');
    }

    const contents = zipEntries.map(entry => entry.entryName.replace(/\\/g, '/')).filter(Boolean);

    // 3. Security Assertions: STRICTLY FORBID sensitive credentials and environment files
    console.log('3. Auditing release contents against sensitive files, credentials, and unwanted artifacts...');
    const forbiddenExact = [
      '.env',
      '.env.local',
      '.env.production',
      '.env.development',
      '.env.test',
      'id_rsa',
      'id_ed25519'
    ];
    const forbiddenExtensions = ['.pem', '.key', '.p12', '.pfx', '.pkcs12'];

    for (const entry of contents) {
      const baseName = path.basename(entry);

      if (forbiddenExact.includes(entry) || forbiddenExact.includes(baseName)) {
        throw new Error(`CRITICAL SECURITY FAILURE: Sensitive environment or key file '${entry}' was detected inside the distribution archive!`);
      }

      if (entry.startsWith('.env') && entry !== '.env.example') {
        throw new Error(`CRITICAL SECURITY FAILURE: Sensitive environment file '${entry}' was detected inside the distribution archive!`);
      }

      for (const ext of forbiddenExtensions) {
        if (entry.toLowerCase().endsWith(ext)) {
          throw new Error(`CRITICAL SECURITY FAILURE: Private credential or certificate file '${entry}' was detected inside the distribution archive!`);
        }
      }

      // Check forbidden directories and large binary/temporary artifacts
      if (entry.startsWith('.git/')) {
        throw new Error(`Packaging hygiene error: Internal git tracking file '${entry}' was included in the distribution archive.`);
      }
      if (entry.startsWith('node_modules/') || entry.includes('/node_modules/')) {
        throw new Error(`Packaging hygiene error: Dependency directory '${entry}' was included in the distribution archive.`);
      }
      if (entry.endsWith('.joblib')) {
        throw new Error(`Packaging hygiene error: Binary model artifact '${entry}' was included in source release. Trained models must be provisioned reproducibly via 'npm run ml:train'.`);
      }
      if (entry.includes('.tempmediaStorage/') || entry.endsWith('.DS_Store') || entry.endsWith('Thumbs.db')) {
        throw new Error(`Packaging hygiene error: Temporary/OS file '${entry}' was included in the distribution archive.`);
      }
      if (entry.endsWith('.tar.gz') || entry.endsWith('.zip') || entry.endsWith('.tar')) {
        throw new Error(`Packaging hygiene error: Raw archive file '${entry}' was included in the distribution archive.`);
      }
    }

    // 4. Verify configuration template is present
    if (!contents.includes('.env.example')) {
      throw new Error("Missing '.env.example' configuration template in release archive.");
    }

    // 5. Verify academic deliverable
    if (!contents.includes('sql/oracle_valettrack.sql')) {
      throw new Error("Missing academic deliverable 'sql/oracle_valettrack.sql' in release archive.");
    }

    // 6. Verify mandatory source and setup files
    const requiredFiles = [
      'package.json',
      'package-lock.json',
      'requirements.txt',
      'README.md',
      'compose.yaml',
      'sql/schema.sql',
      'sql/seed.sql',
      'sql/verify.sql',
      'sql/oracle_valettrack.sql',
      'tests/backend.test.js',
      'server/src/index.js',
      'client/package.json',
      'scripts/run_sql.js',
      'scripts/seed.js',
      'scripts/package_release.js',
      'scripts/train_occupancy_model.py',
      'scripts/predict_occupancy.py',
      'data/models/model_metadata.json'
    ];
    for (const req of requiredFiles) {
      if (!contents.includes(req)) {
        throw new Error(`Missing mandatory release file '${req}' in archive.`);
      }
    }

    // 7. Verify model provisioning procedure
    // Note: The binary artifact (occupancy_model.joblib) is excluded from Git to prevent repository bloat.
    // We verify that the metadata and training pipeline scripts are packaged so recipients can reproduce the model.
    if (!contents.includes('data/models/model_metadata.json') || !contents.includes('scripts/train_occupancy_model.py')) {
      throw new Error('Missing reproducible model training pipeline assets for ML occupancy forecaster.');
    }

    const stat = fs.statSync(outputPath);
    const sizeKb = (stat.size / 1024).toFixed(1);

    console.log('4. Release Packaging Audit Certification:');
    console.log(`* Distribution ZIP:   ${path.basename(outputPath)} (${sizeKb} KB)`);
    console.log(`* Packaged Files:     ${contents.length} verified files`);
    console.log('* Secret Protection:  Zero sensitive .env or credential files included');
    console.log('* Config Template:    Sanitized .env.example included');
    console.log('* Academic Artifact:  sql/oracle_valettrack.sql verified');
    console.log('* ML Reproducibility: model_metadata.json and train_occupancy_model.py verified');
    console.log('* Packaging Hygiene:  EXCLUDED node_modules, .git, scratch, *.joblib, raw archives');
    console.log('=== Release Packaging Successfully Completed ===\n');

    return {
      archivePath: outputPath,
      sizeBytes: stat.size,
      fileCount: contents.length
    };
  } catch (err) {
    // Ensure cleanup does not leave broken or misleading release artifacts
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch {}
    }
    throw err;
  }
}

if (process.argv[1] && process.argv[1].endsWith('package_release.js')) {
  try {
    packageRelease();
  } catch (err) {
    console.error(`[package_release] ERROR: ${err.message}`);
    process.exit(1);
  }
}
