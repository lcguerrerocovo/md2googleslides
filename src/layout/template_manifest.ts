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
  return yaml.load(content) as TemplateManifest;
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
