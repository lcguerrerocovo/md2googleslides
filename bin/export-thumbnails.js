#!/usr/bin/env node
// Export slide thumbnails from a Google Slides presentation as PNG files.
// Usage: node export-thumbnails.js <presentationId> <outputDir>

const {google} = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

async function main() {
  const presentationId = process.argv[2];
  const outputDir = process.argv[3] || path.join(os.tmpdir(), 'slide-thumbnails');

  if (!presentationId) {
    console.error('Usage: export-thumbnails.js <presentationId> [outputDir]');
    process.exit(1);
  }

  fs.mkdirSync(outputDir, {recursive: true});

  // Load credentials (same pattern as md2gslides CLI)
  const clientJson = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), '.md2googleslides', 'client_id.json'))
  );
  const installed = clientJson.installed || clientJson.web;
  const oauth2Client = new google.auth.OAuth2(
    installed.client_id,
    installed.client_secret,
    installed.redirect_uris[0]
  );
  const creds = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), '.md2googleslides', 'credentials.json'))
  );
  oauth2Client.setCredentials(creds);

  const api = google.slides({version: 'v1', auth: oauth2Client});
  const res = await api.presentations.get({presentationId});
  const slides = res.data.slides || [];

  console.log(`Exporting ${slides.length} slides to ${outputDir}`);

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const pageObjectId = slide.objectId;
    const thumbRes = await api.presentations.pages.getThumbnail({
      presentationId,
      pageObjectId,
      'thumbnailProperties.thumbnailSize': 'LARGE',
    });
    const url = thumbRes.data.contentUrl;
    const outPath = path.join(outputDir, `slide-${String(i + 1).padStart(2, '0')}.png`);

    await new Promise((resolve, reject) => {
      https.get(url, response => {
        const file = fs.createWriteStream(outPath);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`  Slide ${i + 1}: ${outPath}`);
          resolve();
        });
      }).on('error', reject);
    });
  }

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
