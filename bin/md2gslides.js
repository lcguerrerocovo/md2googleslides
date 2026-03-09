#!/usr/bin/env node

// Copyright 2016 Google Inc.
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

/* eslint-disable no-console, @typescript-eslint/no-var-requires */

require('babel-polyfill');

const Promise = require('promise');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const process = require('process');
const ArgumentParser = require('argparse').ArgumentParser;
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const SlideGenerator = require('../lib/slide_generator').default;
const {analyzeTemplate} = require('../lib/analyze_template');
const {loadManifest} = require('../lib/layout/template_manifest');
const {extractFrontmatter} = require('../lib/parser/parser');
const opener = require('opener');

const SCOPES = [
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/drive',
];

const USER_HOME =
  process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
const BASE_CONFIG_DIR = path.join(USER_HOME, '.md2googleslides');

const parser = new ArgumentParser({
  version: '1.0.0',
  addHelp: true,
  description: 'Markdown to Slides converter',
});

parser.addArgument('file', {
  help: 'Path to markdown file to convert, If omitted, reads from stdin',
  nargs: '?',
});
parser.addArgument(['-u', '--user'], {
  help: 'Email address of user',
  required: false,
  dest: 'user',
  defaultValue: 'default',
});
parser.addArgument(['-a', '--append'], {
  dest: 'id',
  help: 'Appends slides to an existing presentation',
  required: false,
});
parser.addArgument(['-e', '--erase'], {
  dest: 'erase',
  action: 'storeTrue',
  help: 'Erase existing slides prior to appending.',
  required: false,
});
parser.addArgument(['--no-erase'], {
  dest: 'noErase',
  action: 'storeTrue',
  help: 'Do not erase existing slides when using a frontmatter ID (append instead).',
  required: false,
});
parser.addArgument(['-n', '--no-browser'], {
  action: 'storeTrue',
  dest: 'headless',
  help: 'Headless mode - do not launch browsers, just shows URLs',
  required: false,
});
parser.addArgument(['-s', '--style'], {
  help: 'Name of highlight.js theme for code formatting',
  dest: 'style',
  required: false,
  defaultValue: 'default',
});
parser.addArgument(['-t', '--title'], {
  help: 'Title of the presentation',
  dest: 'title',
  required: false,
});
parser.addArgument(['-c', '--copy'], {
  help: 'Id of the presentation to copy and use as a base',
  dest: 'copy',
  required: false,
});
parser.addArgument(['--template'], {
  help: 'Id of a template presentation to copy and use its layouts/styles',
  dest: 'template',
  required: false,
});
parser.addArgument(['-p', '--project'], {
  help: 'GCP project subdirectory for OAuth credentials (under ~/.md2googleslides/<project>/)',
  dest: 'project',
  required: false,
});
parser.addArgument(['--use-fileio'], {
  help: 'Acknolwedge local and generated images are uploaded to https://file.io',
  action: 'storeTrue',
  dest: 'useFileio',
  required: false,
});
parser.addArgument(['--analyze-template'], {
  help: 'Analyze a template presentation and output JSON metadata for its text boxes',
  dest: 'analyzeTemplate',
  required: false,
});
parser.addArgument(['--manifest'], {
  help: 'Path to a YAML manifest mapping template text boxes to content slots',
  dest: 'manifest',
  required: false,
});

const args = parser.parseArgs();

// Read markdown file early so frontmatter can inform CLI defaults
let markdownSource = null;
let markdownInput = null;
let frontmatter = null;
let idFromFrontmatter = false;
let previousDeckId = null;
let oauth2Client = null;

if (args.file) {
  markdownSource = path.resolve(args.file);
  markdownInput = fs.readFileSync(markdownSource, {encoding: 'UTF-8'});
  const result = extractFrontmatter(markdownInput);
  frontmatter = result.frontmatter;

  if (frontmatter) {
    // Frontmatter values are defaults; CLI flags override
    if (!args.id && frontmatter.id) {
      args.id = frontmatter.id;
      idFromFrontmatter = true;
    }
    if (!args.title && frontmatter.title) {
      args.title = frontmatter.title;
    }
    if (!args.template && frontmatter.template) {
      args.template = frontmatter.template;
    }
    if (!args.manifest && frontmatter.manifest) {
      args.manifest = frontmatter.manifest;
    }
    // When template is active, it creates a fresh deck each run.
    // Don't set id — it would conflict with template mode.
    // Track old ID so we can delete the previous deck after the new one is created.
    if (args.template && idFromFrontmatter) {
      previousDeckId = args.id;
      args.id = null;
      idFromFrontmatter = false;
    }
  }
}

const configDir = args.project
  ? path.join(BASE_CONFIG_DIR, args.project)
  : BASE_CONFIG_DIR;
const STORED_CREDENTIALS_PATH = path.join(configDir, 'credentials.json');
const STORED_CLIENT_ID_PATH = path.join(configDir, 'client_id.json');

function handleError(err) {
  console.log('Unable to generate slides:', err);
}

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fsp.readFile(STORED_CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fsp.readFile(STORED_CLIENT_ID_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fsp.writeFile(STORED_CREDENTIALS_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: STORED_CLIENT_ID_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

function buildSlideGenerator(oauth2Client) {
  const title = args.title || args.file;
  const presentationId = args.id;
  const copyId = args.copy;
  const templateId = args.template;

  if (templateId && copyId) {
    console.error('--template and --copy are mutually exclusive');
    process.exit(1);
  }
  if (templateId && presentationId) {
    console.error('--template and --append are mutually exclusive');
    process.exit(1);
  }

  if (presentationId) {
    return SlideGenerator.forPresentation(oauth2Client, presentationId);
  } else if (templateId) {
    return SlideGenerator.fromTemplate(oauth2Client, title, templateId);
  } else if (copyId) {
    return SlideGenerator.copyPresentation(oauth2Client, title, copyId);
  } else {
    return SlideGenerator.newPresentation(oauth2Client, title);
  }
}

function eraseIfNeeded(slideGenerator) {
  if (args.template) {
    // Template slides are needed for cloning; they'll be cleaned up
    // after cloning in generateFromMarkdown()
    return Promise.resolve(slideGenerator);
  }
  if (args.noErase) {
    return Promise.resolve(slideGenerator);
  }
  // Erase when: explicit --erase, OR ID from frontmatter (iterative workflow),
  // OR no ID at all (new presentation has placeholder slide to remove)
  if (args.erase || idFromFrontmatter || !args.id) {
    return slideGenerator.erase().then(() => {
      return slideGenerator;
    });
  } else {
    return Promise.resolve(slideGenerator);
  }
}

function loadCss(theme) {
  const cssPath = path.join(
    require.resolve('highlight.js'),
    '..',
    '..',
    'styles',
    theme + '.css'
  );
  const css = fs.readFileSync(cssPath, {encoding: 'UTF-8'});
  return css;
}

function generateSlides(slideGenerator) {
  if (args.file && !markdownInput) {
    markdownSource = path.resolve(args.file);
    markdownInput = fs.readFileSync(markdownSource, {encoding: 'UTF-8'});
  }
  if (markdownSource) {
    process.chdir(path.dirname(markdownSource));
  }
  const input = markdownInput || fs.readFileSync(0, {encoding: 'UTF-8'});
  const css = loadCss(args.style);

  return slideGenerator.generateFromMarkdown(input, {
    css: css,
    useFileio: args.useFileio,
  });
}

function writeFrontmatterId(id) {
  if (!markdownSource || !args.file) {
    return;
  }
  const raw = fs.readFileSync(markdownSource, {encoding: 'UTF-8'});
  let updated;
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    const fmBlock = fmMatch[1];
    if (fmBlock.match(/^id:\s+/m)) {
      // Replace existing id
      const newFmBlock = fmBlock.replace(/^id:\s+.*$/m, 'id: ' + id);
      updated = raw.replace(fmMatch[0], '---\n' + newFmBlock + '\n---\n');
    } else {
      // Add id to existing frontmatter
      const newFmBlock = fmBlock + '\nid: ' + id;
      updated = raw.replace(fmMatch[0], '---\n' + newFmBlock + '\n---\n');
    }
  } else {
    // No frontmatter — prepend one
    updated = '---\nid: ' + id + '\n---\n' + raw;
  }
  fs.writeFileSync(markdownSource, updated, {encoding: 'UTF-8'});
  console.log('Saved presentation ID to %s', args.file);
}

async function deletePreviousDeck() {
  if (!previousDeckId || !oauth2Client) {
    return;
  }
  try {
    const drive = google.drive({version: 'v3', auth: oauth2Client});
    await drive.files.delete({fileId: previousDeckId});
    console.log('Deleted previous deck %s', previousDeckId);
  } catch (err) {
    console.warn('Could not delete previous deck %s: %s', previousDeckId, err.message);
  }
}

async function displayResults(id) {
  writeFrontmatterId(id);
  await deletePreviousDeck();
  const url = 'https://docs.google.com/presentation/d/' + id;
  if (args.headless) {
    console.log('View your presentation at: %s', url);
  } else {
    console.log('Opening your presentation (%s)', url);
    opener(url);
  }
}
if (args.analyzeTemplate) {
  authorize()
    .then(oauth2Client => {
      const api = google.slides({version: 'v1', auth: oauth2Client});
      return analyzeTemplate(api, args.analyzeTemplate);
    })
    .catch(handleError);
} else {
  authorize()
    .then(client => {
      oauth2Client = client;
      return client;
    })
    .then(buildSlideGenerator)
    .then(slideGenerator => {
      if (args.manifest) {
        const manifestPath = path.resolve(args.manifest);
        const manifest = loadManifest(manifestPath);
        slideGenerator.setManifest(manifest);
      }
      return slideGenerator;
    })
    .then(eraseIfNeeded)
    .then(generateSlides)
    .then(displayResults)
    .catch(handleError);
}
