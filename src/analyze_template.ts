import {slides_v1 as SlidesV1} from 'googleapis';

interface TextBoxInfo {
  element_index: number;
  element_id: string;
  text_content: string;
  position: {translateX: number; translateY: number};
  size: {width: number; height: number};
  font?: {family?: string; size_pt?: number};
}

interface SlideInfo {
  slide_index: number;
  slide_id: string;
  text_boxes: TextBoxInfo[];
}

interface TemplateAnalysis {
  template_id: string;
  slide_count: number;
  slides: SlideInfo[];
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

function extractFont(
  textElements: SlidesV1.Schema$TextElement[] | undefined
): {family?: string; size_pt?: number} | undefined {
  if (!textElements) return undefined;
  const firstRun = textElements.find(te => te.textRun?.style);
  if (!firstRun?.textRun?.style) return undefined;
  const style = firstRun.textRun.style;
  const result: {family?: string; size_pt?: number} = {};
  if (style.fontFamily) result.family = style.fontFamily;
  if (style.fontSize?.magnitude && style.fontSize?.unit === 'PT') {
    result.size_pt = style.fontSize.magnitude;
  }
  if (Object.keys(result).length === 0) return undefined;
  return result;
}

export async function analyzeTemplate(
  api: SlidesV1.Slides,
  presentationId: string
): Promise<void> {
  const res = await api.presentations.get({presentationId});
  const presentation = res.data;
  const slides = presentation.slides ?? [];

  const analysis: TemplateAnalysis = {
    template_id: presentationId,
    slide_count: slides.length,
    slides: [],
  };

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const slideInfo: SlideInfo = {
      slide_index: i + 1,
      slide_id: slide.objectId ?? '',
      text_boxes: [],
    };

    const elements = slide.pageElements ?? [];
    for (let j = 0; j < elements.length; j++) {
      const element = elements[j];
      if (element.shape?.shapeType !== 'TEXT_BOX') continue;

      const transform = element.transform;
      const size = element.size;

      const info: TextBoxInfo = {
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
      };

      const font = extractFont(element.shape?.text?.textElements);
      if (font) info.font = font;

      slideInfo.text_boxes.push(info);
    }

    analysis.slides.push(slideInfo);
  }

  console.log(JSON.stringify(analysis, null, 2));
}
