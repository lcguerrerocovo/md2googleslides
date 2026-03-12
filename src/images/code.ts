import Debug from 'debug';
import {execFileSync} from 'child_process';
import tmp from 'tmp-promise';
import {ImageDefinition} from '../slides';
import assert from 'assert';

const debug = Debug('md2gslides');
tmp.setGracefulCleanup();

async function renderCode(image: ImageDefinition): Promise<string> {
  debug('Rendering code block to image');
  assert(image.source);

  const outputPath = await tmp.tmpName({postfix: '.png'});

  let language: string | undefined;
  let theme = 'OneHalfDark';

  if (image.style) {
    const parts = image.style.split(';');
    for (const part of parts) {
      const [key, value] = part.split('=').map(s => s.trim());
      if (key === 'lang' && value) {
        language = value;
      } else if (key === 'theme' && value) {
        theme = value;
      }
    }
  }

  const args: string[] = [
    image.source,
    '-o', outputPath,
    '--theme', theme,
    '--no-window-controls',
    '--no-line-number',
    '--no-round-corner',
    '--pad-horiz', '30',
    '--pad-vert', '30',
  ];

  if (language) {
    args.push('--language', language);
  }

  debug('Running: silicon %s', args.join(' '));
  execFileSync('silicon', args, {stdio: 'pipe'});

  return outputPath;
}

export default renderCode;
