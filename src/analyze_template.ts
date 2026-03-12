import {slides_v1 as SlidesV1} from 'googleapis';
import * as yaml from 'js-yaml';

interface TextBoxInfo {
  element_index: number;
  element_id: string;
  text_content: string;
  position: {translateX: number; translateY: number};
  size: {width: number; height: number};
  font_size_pt: number;
}

interface SlotAssignment {
  role: string;
  element_index: number;
}

function extractTextContent(
  textElements: SlidesV1.Schema$TextElement[] | undefined
): string {
  if (!textElements) return '';
  return textElements
    .filter(te => te.textRun?.content)
    .map(te => te.textRun!.content!)
    .join('')
    .trim();
}

function extractFontSizePt(
  textElements: SlidesV1.Schema$TextElement[] | undefined
): number {
  if (!textElements) return 0;
  // Find the largest font size among all text runs (not just the first)
  let maxSize = 0;
  for (const te of textElements) {
    const style = te.textRun?.style;
    if (style?.fontSize?.magnitude && style.fontSize.unit === 'PT') {
      maxSize = Math.max(maxSize, style.fontSize.magnitude);
    }
  }
  return maxSize;
}

function emuToPt(emu: number): number {
  return Math.round(emu / 12700);
}

function generateSlideName(textBoxes: TextBoxInfo[]): string {
  if (textBoxes.length === 0) return 'Empty slide';

  // Sort by font size descending to find the "title" text
  const sorted = [...textBoxes].sort((a, b) => b.font_size_pt - a.font_size_pt);
  const titleText = sorted[0].text_content;

  if (!titleText) return 'Untitled slide';

  // Clean up: collapse whitespace, take first ~30 chars
  const cleaned = titleText.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 30) return cleaned;
  // Cut at word boundary
  const truncated = cleaned.substring(0, 30);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 15 ? truncated.substring(0, lastSpace) : truncated) + '…';
}

function classifySlots(textBoxes: TextBoxInfo[]): SlotAssignment[] {
  if (textBoxes.length === 0) return [];

  // Sort by font size descending
  const sorted = [...textBoxes].sort((a, b) => b.font_size_pt - a.font_size_pt);

  const assignments: SlotAssignment[] = [];

  // Largest font → title
  assignments.push({role: 'title', element_index: sorted[0].element_index});

  if (sorted.length === 2) {
    // Exactly 2 text boxes: assign second as both subtitle AND body.
    // This way both ## (subtitle) and paragraph text (body) work.
    assignments.push({
      role: 'subtitle',
      element_index: sorted[1].element_index,
    });
    assignments.push({role: 'body', element_index: sorted[1].element_index});
  } else if (sorted.length >= 3) {
    // 3+ text boxes: second is subtitle, third is body, rest are body_N
    assignments.push({
      role: 'subtitle',
      element_index: sorted[1].element_index,
    });
    assignments.push({role: 'body', element_index: sorted[2].element_index});
    for (let i = 3; i < sorted.length; i++) {
      assignments.push({
        role: `body_${i - 1}`,
        element_index: sorted[i].element_index,
      });
    }
  }

  return assignments;
}

function computeImageAreaFromTextBoxes(
  textBoxes: TextBoxInfo[],
  pageWidth: number,
  pageHeight: number
): {x: number; y: number; width: number; height: number} | null {
  if (textBoxes.length === 0) {
    return null;
  }

  let maxRight = 0;
  let maxBottom = 0;
  let minLeft = pageWidth;
  let minTop = pageHeight;

  for (const tb of textBoxes) {
    const right = tb.position.translateX + tb.size.width;
    const bottom = tb.position.translateY + tb.size.height;
    maxRight = Math.max(maxRight, right);
    maxBottom = Math.max(maxBottom, bottom);
    minLeft = Math.min(minLeft, tb.position.translateX);
    minTop = Math.min(minTop, tb.position.translateY);
  }

  const gap = minLeft;

  const rightArea = {
    x: maxRight + gap,
    y: minTop,
    width: pageWidth - maxRight - gap - minLeft,
    height: pageHeight - minTop - gap,
  };

  const bottomArea = {
    x: minLeft,
    y: maxBottom + gap,
    width: pageWidth - minLeft * 2,
    height: pageHeight - maxBottom - gap - minLeft,
  };

  const rightSize = rightArea.width * rightArea.height;
  const bottomSize = bottomArea.width * bottomArea.height;

  if (rightSize > 0 && rightSize >= bottomSize) {
    return rightArea;
  }
  if (bottomSize > 0) {
    return bottomArea;
  }
  return null;
}

function formatTextBoxComment(tb: TextBoxInfo): string {
  const sizeW = emuToPt(tb.size.width);
  const sizeH = emuToPt(tb.size.height);
  const posX = emuToPt(tb.position.translateX);
  const posY = emuToPt(tb.position.translateY);
  const textPreview =
    tb.text_content.length > 40
      ? tb.text_content.substring(0, 40).replace(/\n/g, '↵') + '…'
      : tb.text_content.replace(/\n/g, '↵');
  return `[${tb.element_index}] ${tb.font_size_pt}pt "${textPreview}" (${sizeW}x${sizeH} at ${posX},${posY})`;
}

export async function analyzeTemplate(
  api: SlidesV1.Slides,
  presentationId: string
): Promise<void> {
  const res = await api.presentations.get({presentationId});
  const presentation = res.data;
  const slides = presentation.slides ?? [];
  const pageWidth = presentation.pageSize?.width?.magnitude ?? 0;
  const pageHeight = presentation.pageSize?.height?.magnitude ?? 0;

  // Build the YAML structure
  const slidesMap: Record<number, unknown> = {};

  // First pass: collect all raw names so we can deduplicate
  const rawNames: {name: string; textBoxes: TextBoxInfo[]}[] = [];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const elements = slide.pageElements ?? [];
    const textBoxes: TextBoxInfo[] = [];

    for (let j = 0; j < elements.length; j++) {
      const element = elements[j];
      if (element.shape?.shapeType !== 'TEXT_BOX') continue;

      const transform = element.transform;
      const size = element.size;

      textBoxes.push({
        element_index: j,
        element_id: element.objectId ?? '',
        text_content: extractTextContent(element.shape?.text?.textElements),
        position: {
          translateX: transform?.translateX ?? 0,
          translateY: transform?.translateY ?? 0,
        },
        size: {
          width: size?.width?.magnitude ?? 0,
          height: size?.height?.magnitude ?? 0,
        },
        font_size_pt: extractFontSizePt(element.shape?.text?.textElements),
      });
    }

    rawNames.push({name: generateSlideName(textBoxes), textBoxes});
  }

  // Deduplicate: first occurrence keeps plain name, subsequent get " (2)", " (3)", etc.
  const nameCounts: Record<string, number> = {};
  for (const entry of rawNames) {
    nameCounts[entry.name] = (nameCounts[entry.name] || 0) + 1;
  }
  const nameNextIndex: Record<string, number> = {};
  const deduplicatedNames: string[] = rawNames.map(entry => {
    if (nameCounts[entry.name] <= 1) return entry.name;
    nameNextIndex[entry.name] = (nameNextIndex[entry.name] || 0) + 1;
    if (nameNextIndex[entry.name] === 1) return entry.name;
    return `${entry.name} (${nameNextIndex[entry.name]})`;
  });

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const slideId = slide.objectId ?? '';
    const slideNumber = i + 1;
    const textBoxes = rawNames[i].textBoxes;

    const previewUrl = `https://docs.google.com/presentation/d/${presentationId}/edit#slide=id.${slideId}`;
    const slideName = deduplicatedNames[i];
    const slots = classifySlots(textBoxes);

    const slideEntry: Record<string, unknown> = {
      name: slideName,
      preview: previewUrl,
    };

    if (slots.length > 0) {
      const slotsMap: Record<string, {element_index: number}> = {};
      for (const slot of slots) {
        slotsMap[slot.role] = {element_index: slot.element_index};
      }
      slideEntry.slots = slotsMap;
    }

    if (textBoxes.length > 0 && pageWidth > 0 && pageHeight > 0) {
      const imageArea = computeImageAreaFromTextBoxes(
        textBoxes,
        pageWidth,
        pageHeight
      );
      if (imageArea) {
        slideEntry.image_area = imageArea;
      }
    }

    slidesMap[slideNumber] = slideEntry;
  }

  const doc = {
    template_id: presentationId,
    slides: slidesMap,
  };

  // Generate YAML
  const yamlStr = yaml.dump(doc, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
    sortKeys: false,
  });

  // Now we need to inject text_box comments before each slide's slots
  // We'll do this by post-processing the YAML output
  const lines = yamlStr.split('\n');
  const output: string[] = [];

  // Build a lookup: slideNumber → textBoxes
  const textBoxesBySlide: Map<number, TextBoxInfo[]> = new Map();
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const elements = slide.pageElements ?? [];
    const textBoxes: TextBoxInfo[] = [];

    for (let j = 0; j < elements.length; j++) {
      const element = elements[j];
      if (element.shape?.shapeType !== 'TEXT_BOX') continue;

      textBoxes.push({
        element_index: j,
        element_id: element.objectId ?? '',
        text_content: extractTextContent(element.shape?.text?.textElements),
        position: {
          translateX: element.transform?.translateX ?? 0,
          translateY: element.transform?.translateY ?? 0,
        },
        size: {
          width: element.size?.width?.magnitude ?? 0,
          height: element.size?.height?.magnitude ?? 0,
        },
        font_size_pt: extractFontSizePt(element.shape?.text?.textElements),
      });
    }

    textBoxesBySlide.set(i + 1, textBoxes);
  }

  // Post-process: inject text_boxes comments after "preview:" lines
  for (let i = 0; i < lines.length; i++) {
    output.push(lines[i]);

    // Detect preview lines - they follow the pattern "    preview: ..."
    const previewMatch = lines[i].match(/^(\s+)preview:/);
    if (previewMatch) {
      const indent = previewMatch[1];

      // Find which slide number this belongs to by scanning backwards
      for (let j = i - 1; j >= 0; j--) {
        const slideNumMatch = lines[j].match(/^\s+"?(\d+)"?:/);
        if (slideNumMatch) {
          const slideNum = parseInt(slideNumMatch[1], 10);
          const tbs = textBoxesBySlide.get(slideNum);
          if (tbs && tbs.length > 0) {
            output.push(`${indent}# text_boxes:`);
            for (const tb of tbs) {
              output.push(`${indent}#   ${formatTextBoxComment(tb)}`);
            }
          }
          break;
        }
      }
    }
  }

  console.log(output.join('\n'));
}
