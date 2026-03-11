import Debug from 'debug';
import {execFileSync} from 'child_process';
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

  const args: string[] = [];
  let hasScale = false;

  if (image.style) {
    const parts = image.style.split(';');
    for (const part of parts) {
      const [key, value] = part.split('=').map(s => s.trim());
      if (key === 'theme' && value) {
        args.push('--theme', value);
      } else if (key === 'layout' && value) {
        args.push('--layout', value);
      } else if (key === 'scale' && value) {
        args.push('--scale', value);
        hasScale = true;
      }
    }
  }
  if (!hasScale) {
    args.push('--scale', '1');
  }

  args.push(inputPath, outputPath);

  debug('Running: d2 %s', args.join(' '));
  execFileSync('d2', args, {stdio: 'pipe'});

  return outputPath;
}

export default renderD2;
