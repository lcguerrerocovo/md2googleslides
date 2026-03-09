import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {slides_v1 as SlidesV1} from 'googleapis';
import {findPage} from './presentation_helpers';

export interface ManifestSlotDef {
  element_index: number;
}

export interface ManifestSlideDef {
  name?: string;
  slots: Record<string, ManifestSlotDef>;
}

export interface TemplateManifest {
  template_id: string;
  slides: Record<number, ManifestSlideDef>;
}

export function loadManifest(filePath: string): TemplateManifest {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = yaml.load(content) as TemplateManifest;
  if (!data || typeof data.slides !== 'object') {
    throw new Error(`Invalid manifest: missing or invalid "slides" key in ${filePath}`);
  }
  for (const [slideNum, slideDef] of Object.entries(data.slides)) {
    if (!slideDef || typeof slideDef.slots !== 'object') {
      throw new Error(`Invalid manifest: slide ${slideNum} missing "slots" in ${filePath}`);
    }
    for (const [slotName, slotDef] of Object.entries(slideDef.slots)) {
      if (typeof slotDef?.element_index !== 'number') {
        throw new Error(
          `Invalid manifest: slide ${slideNum} slot "${slotName}" missing numeric "element_index" in ${filePath}`
        );
      }
    }
  }
  return data;
}

export function resolveSlotObjectId(
  presentation: SlidesV1.Schema$Presentation,
  slideObjectId: string,
  slotDef: ManifestSlotDef
): string | undefined {
  const page = findPage(presentation, slideObjectId);
  if (!page || !page.pageElements) {
    return undefined;
  }
  const element = page.pageElements[slotDef.element_index];
  return element?.objectId ?? undefined;
}
