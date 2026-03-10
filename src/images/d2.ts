import Debug from 'debug';
import {execSync} from 'child_process';
import tmp from 'tmp-promise';
import {ImageDefinition} from '../slides';
import assert from 'assert';

const debug = Debug('md2gslides');
tmp.setGracefulCleanup();

async function renderD2(image: ImageDefinition): Promise<string> {
  debug('Rendering d2 diagram', image);
  assert(image.source);

  const inputPath = image.source;
  const outputPath = await tmp.tmpName({postfix: '.png'});

  const args = ['--scale', '2'];

  if (image.style) {
    const parts = image.style.split(';');
    for (const part of parts) {
      const [key, value] = part.split('=').map(s => s.trim());
      if (key === 'theme' && value) {
        args.push('--theme', value);
      } else if (key === 'layout' && value) {
        args.push('--layout', value);
      }
    }
  }

  args.push(inputPath, outputPath);

  const cmd = 'd2 ' + args.map(a => `'${a}'`).join(' ');
  debug('Running: %s', cmd);
  execSync(cmd, {stdio: 'pipe'});

  return outputPath;
}

export default renderD2;
