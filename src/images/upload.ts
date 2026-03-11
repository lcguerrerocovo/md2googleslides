// Copyright 2019 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import Debug from 'debug';
import fs from 'fs';
import {google} from 'googleapis';
import {OAuth2Client} from 'google-auth-library';

const debug = Debug('md2gslides');

/**
 * Uploads a local file to Google Drive so it is HTTP/S accessible.
 * The file is made publicly readable so Google Slides can fetch it.
 *
 * @param {OAuth2Client} auth - Authorized OAuth2 client
 * @param {string} filePath -- Local path to image to upload
 * @returns {Promise<string>} URL to hosted image
 */
async function uploadLocalImage(
  auth: OAuth2Client,
  filePath: string
): Promise<string> {
  debug('Uploading file to Drive: %s', filePath);
  const drive = google.drive({version: 'v3', auth});
  const res = await drive.files.create({
    requestBody: {
      name: `md2gslides-${Date.now()}-${filePath.split('/').pop()}`,
    },
    media: {
      mimeType: 'image/png',
      body: fs.createReadStream(filePath),
    },
    fields: 'id,webContentLink',
  });
  const fileId = res.data.id!;
  debug('Uploaded file ID: %s', fileId);

  // Make the file publicly readable so Slides API can fetch it
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  const url = `https://drive.google.com/uc?id=${fileId}&export=download`;
  debug('Public URL: %s', url);
  return url;
}

export default uploadLocalImage;
