#!/usr/bin/env node

/**
 * =========================================================================
 * MindAR Image Target CLI Compiler
 * =========================================================================
 * 
 * Compiles target images into a single `targets.mind` binary for MindAR AR tracking.
 * Runs completely from the command line using headless Chrome/Edge and the official
 * standalone MindAR compiler engine.
 *
 * USAGE:
 *   1) By sequence list:
 *      node compile.js img1.png img2.png img3.png -o targets.mind
 *
 *   2) By folder + order:
 *      node compile.js --folder Assets/Images --order Coffe_cup_marker.png,Vintage_compass_marker.png,Golden_microphone_marker.png -o Assets/Targets/targets.mind
 *
 *   3) Default (compiles project hunt targets):
 *      node compile.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ==========================================
// BROWSER AUTO-DETECTION
// ==========================================
function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const candidates = [];

  if (isWin) {
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localApp = process.env['LOCALAPPDATA'] || '';

    candidates.push(
      path.join(progFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(progFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(progFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(progFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(localApp, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(localApp, 'Microsoft\\Edge\\Application\\msedge.exe')
    );
  } else if (isMac) {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    );
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }

  throw new Error(
    'No supported browser (Chrome or Edge) was found.\n' +
    'Please install Google Chrome or Microsoft Edge, or set the CHROME_PATH environment variable.'
  );
}

// ==========================================
// ARGUMENT PARSING
// ==========================================
function parseArgs() {
  const args = process.argv.slice(2);
  let folder = null;
  let orderStr = null;
  let outputPath = 'Assets/Targets/targets.mind';
  const positionalImages = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--folder' || a === '-f') {
      folder = args[++i];
    } else if (a === '--order') {
      orderStr = args[++i];
    } else if (a === '--output' || a === '-o') {
      outputPath = args[++i];
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith('-')) {
      positionalImages.push(a);
    }
  }

  let finalImages = [];

  if (folder && orderStr) {
    const filenames = orderStr.split(',').map(s => s.trim()).filter(Boolean);
    finalImages = filenames.map(name => path.resolve(folder, name));
  } else if (folder && positionalImages.length > 0) {
    finalImages = positionalImages.map(name => path.resolve(folder, name));
  } else if (positionalImages.length > 0) {
    finalImages = positionalImages.map(p => path.resolve(p));
  } else {
    // Default project images in sequential tracking order
    const defaultList = [
      'Assets/Images/Coffe_cup_marker.png',
      'Assets/Images/Vintage_compass_marker.png',
      'Assets/Images/Golden_microphone_marker.png'
    ];
    finalImages = defaultList.map(p => path.resolve(process.cwd(), p));
  }

  return {
    images: finalImages,
    output: path.resolve(process.cwd(), outputPath)
  };
}

function printHelp() {
  console.log(`
MindAR Image Target CLI Compiler
================================
Compiles image targets into a single .mind binary file for MindAR AR tracking.

USAGE:
  node compile.js [options] [image1 image2 image3 ...]

OPTIONS:
  -f, --folder <dir>       Source directory containing target images
  --order <f1,f2,f3>       Comma-separated sequence of filenames (Target 0, Target 1, Target 2...)
  -o, --output <file>      Destination path (default: Assets/Targets/targets.mind)
  -h, --help               Show this help message

EXAMPLES:
  # 1. Provide images in order as arguments:
  node compile.js card1.png card2.png card3.png -o targets.mind

  # 2. Provide a folder and an explicit sequence:
  node compile.js --folder Assets/Images --order Coffe_cup_marker.png,Vintage_compass_marker.png,Golden_microphone_marker.png -o Assets/Targets/targets.mind

  # 3. Default run (compiles project hunt targets):
  node compile.js
`);
}

// ==========================================
// COMPILATION RUNNER
// ==========================================
async function main() {
  const { images, output } = parseArgs();

  console.log('\n========================================');
  console.log('🧭 MindAR Image Targets CLI Compiler');
  console.log('========================================');

  // Verify all image files exist
  console.log('\nTarget Sequence:');
  for (let idx = 0; idx < images.length; idx++) {
    const imgPath = images[idx];
    if (!fs.existsSync(imgPath)) {
      console.error(`\n❌ Error: Target #${idx} file not found: ${imgPath}`);
      process.exit(1);
    }
    const sz = (fs.statSync(imgPath).size / 1024).toFixed(1);
    console.log(`  [Target #${idx}] ${path.basename(imgPath)} (${sz} KB) -> ${imgPath}`);
  }

  console.log(`\nOutput file: ${output}`);

  const browserPath = findBrowser();
  console.log(`Using browser: ${path.basename(browserPath)}`);

  // Path to local MindAR compiler script
  const localScriptPath = path.resolve(__dirname, 'scripts/mindar-image.prod.js');
  if (!fs.existsSync(localScriptPath)) {
    console.error(`\n❌ Error: Missing local MindAR library at ${localScriptPath}`);
    process.exit(1);
  }

  let browserProc = null;

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');
    const pathname = urlObj.pathname;

    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MindAR Compiler</title>
  <!-- Load official standalone MindAR compiler bundle directly from local server -->
  <script src="/mindar-image.prod.js"></script>
</head>
<body style="background:#111;color:#eee;font-family:sans-serif;padding:20px;">
  <h2>MindAR Target Compiler Headless Runner</h2>
  <div id="status">Initializing...</div>
  <script>
    const log = async (msg) => {
      document.getElementById('status').innerText = msg;
      await fetch('/log?msg=' + encodeURIComponent(msg)).catch(() => {});
    };

    window.onerror = (msg, src, line, col, err) => {
      fetch('/error?msg=' + encodeURIComponent('[Window Error] ' + msg + ' at ' + line + ':' + col)).catch(() => {});
    };

    window.onunhandledrejection = (e) => {
      fetch('/error?msg=' + encodeURIComponent('[Unhandled Rejection] ' + (e.reason ? (e.reason.message || e.reason) : 'Unknown'))).catch(() => {});
    };

    const loadImage = (url) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image from ' + url));
        img.src = url;
      });
    };

    async function run() {
      try {
        await log('Engine initialized. Fetching image manifest...');
        const res = await fetch('/manifest');
        const manifest = await res.json();

        const loadedImages = [];
        for (let i = 0; i < manifest.count; i++) {
          await log('Loading target image [' + (i+1) + '/' + manifest.count + ']...');
          const img = await loadImage('/image/' + i);
          loadedImages.push(img);
        }

        await log('Initializing MindAR Compiler...');
        const Compiler = window.MINDAR && window.MINDAR.IMAGE ? window.MINDAR.IMAGE.Compiler : null;
        if (!Compiler) {
          throw new Error('MINDAR.IMAGE.Compiler not found in loaded bundle.');
        }

        const compiler = new Compiler();
        await log('Extracting feature tracking points (ORB descriptors)...');

        let lastReported = -1;
        await compiler.compileImageTargets(loadedImages, (progress) => {
          const p = Math.round(progress);
          if (p !== lastReported) {
            lastReported = p;
            log('Compiling tracking features: ' + p + '%');
          }
        });

        await log('Exporting .mind binary buffer...');
        const buffer = await compiler.exportData();
        await log('Compilation complete (' + buffer.byteLength + ' bytes). Sending to host...');

        await fetch('/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buffer
        });

      } catch (err) {
        await fetch('/error?msg=' + encodeURIComponent(err.message + '\\n' + err.stack));
      }
    }

    run();
  </script>
</body>
</html>`);
    } else if (pathname === '/mindar-image.prod.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      fs.createReadStream(localScriptPath).pipe(res);
    } else if (pathname === '/manifest') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: images.length }));
    } else if (pathname.startsWith('/image/')) {
      const idx = parseInt(pathname.replace('/image/', ''), 10);
      if (idx >= 0 && idx < images.length) {
        const filePath = images[idx];
        const ext = path.extname(filePath).toLowerCase();
        const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end();
      }
    } else if (pathname === '/log') {
      const msg = urlObj.searchParams.get('msg') || '';
      console.log(`  ⚡ [Compiler] ${msg}`);
      res.writeHead(200);
      res.end('OK');
    } else if (pathname === '/error') {
      const msg = urlObj.searchParams.get('msg') || 'Unknown compilation error';
      console.error(`\n❌ [Compiler Error] ${msg}`);
      res.writeHead(200);
      res.end('OK');
      cleanExit(1);
    } else if (pathname === '/save' && req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, fullBuffer);

        const szMb = (fullBuffer.length / (1024 * 1024)).toFixed(2);
        console.log(`\n✅ SUCCESS! Exported targets file:`);
        console.log(`   📁 ${output} (${szMb} MB)`);
        console.log(`   🎯 Contains ${images.length} tracking targets in exact order.`);
        console.log('========================================\n');

        res.writeHead(200);
        res.end('OK');
        cleanExit(0);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  function cleanExit(code) {
    if (browserProc) {
      try { browserProc.kill(); } catch (e) {}
    }
    server.close(() => {
      process.exit(code);
    });
    setTimeout(() => process.exit(code), 1000);
  }

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const runnerUrl = `http://127.0.0.1:${port}/`;

    console.log(`\nLaunching headless compiler at ${runnerUrl}...`);

    browserProc = spawn(browserPath, [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      runnerUrl
    ], { stdio: 'ignore' });

    browserProc.on('error', (err) => {
      console.error(`❌ Failed to spawn browser (${browserPath}):`, err);
      cleanExit(1);
    });

    browserProc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`Browser process exited with code ${code}`);
      }
    });
  });
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
