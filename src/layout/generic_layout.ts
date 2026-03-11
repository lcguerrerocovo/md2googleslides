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

import Debug from 'debug';
import {uuid} from '../utils';
import extend from 'extend';
// @ts-ignore
import Layout from 'layout';
import * as _ from 'lodash';
import {slides_v1 as SlidesV1} from 'googleapis';
import {
  ImageDefinition,
  SlideDefinition,
  TableDefinition,
  TextDefinition,
  VideoDefinition,
} from '../slides';
import {
  findLayoutIdByName,
  findPage,
  findPlaceholder,
  findSpeakerNotesObjectId,
} from './presentation_helpers';
import {
  ManifestSlotDef,
  ManifestSlideDef,
  TemplateManifest,
  resolveSlotElement,
  resolveSlotObjectId,
} from './template_manifest';
import assert from 'assert';

const debug = Debug('md2gslides');

interface BoundingBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * Performs most of the work of converting a slide into API requests.
 *
 */
export default class GenericLayout {
  public name: string;
  public presentation: SlidesV1.Schema$Presentation;
  private slide: SlideDefinition;
  private masterObjectId?: string;
  private manifest?: TemplateManifest;

  public constructor(
    name: string,
    presentation: SlidesV1.Schema$Presentation,
    slide: SlideDefinition,
    masterObjectId?: string,
    manifest?: TemplateManifest
  ) {
    this.name = name;
    this.presentation = presentation;
    this.slide = slide;
    this.masterObjectId = masterObjectId;
    this.manifest = manifest;
  }

  public appendCreateSlideRequest(
    requests: SlidesV1.Schema$Request[]
  ): SlidesV1.Schema$Request[] {
    const layoutId = findLayoutIdByName(
      this.presentation,
      this.name,
      this.masterObjectId
    );
    if (!layoutId) {
      throw new Error(`Unable to find layout ${this.name}`);
    }
    this.slide.objectId = uuid();

    debug('Creating slide %s with layout %s', this.slide.objectId, this.name);
    requests.push({
      createSlide: {
        slideLayoutReference: {
          layoutId: layoutId,
        },
        objectId: this.slide.objectId,
      },
    });
    return requests;
  }

  public appendContentRequests(
    requests: SlidesV1.Schema$Request[]
  ): SlidesV1.Schema$Request[] {
    if (this.slide.templateSlide !== undefined && this.manifest) {
      const slideDef = this.manifest.slides[this.slide.templateSlide as number];
      if (slideDef && slideDef.slots) {
        assert(this.slide.objectId);
        // Clear all text boxes on the cloned slide to remove placeholder text
        // This must happen before any insertText requests since those rely
        // on the hasTextContent guard to avoid double-clearing
        this.clearUnusedTextBoxes(slideDef, requests);
        // Collect all slot elements used for text so images can be placed
        // in the remaining free area of the slide
        const usedSlotElements: SlidesV1.Schema$PageElement[] = [];
        for (const slotKey of [
          'title',
          'subtitle',
          'body',
          'body_0',
          'body_1',
        ]) {
          const slotDef = slideDef.slots[slotKey];
          if (slotDef) {
            const el = resolveSlotElement(
              this.presentation,
              this.slide.objectId,
              slotDef
            );
            if (el) usedSlotElements.push(el);
          }
        }
        // Title
        if (this.slide.title && slideDef.slots.title) {
          const objectId = resolveSlotObjectId(
            this.presentation,
            this.slide.objectId,
            slideDef.slots.title
          );
          if (objectId) {
            this.appendInsertTextRequests(
              this.slide.title,
              {objectId},
              requests
            );
          }
        }
        // Subtitle
        if (this.slide.subtitle && slideDef.slots.subtitle) {
          const objectId = resolveSlotObjectId(
            this.presentation,
            this.slide.objectId,
            slideDef.slots.subtitle
          );
          if (objectId) {
            this.appendInsertTextRequests(
              this.slide.subtitle,
              {objectId},
              requests
            );
          }
        }
        // Bodies
        const bodySlots = [
          slideDef.slots.body ?? slideDef.slots.body_0,
          slideDef.slots.body_1,
        ].filter((s): s is ManifestSlotDef => s !== undefined && s !== null);

        // If this slide has images or tables, clear decorative shapes from
        // the image area so they don't overlap with the new content
        const hasImages = this.slide.bodies.some(b => b.images?.length);
        const hasTables = this.slide.tables.length > 0;
        if (hasImages || hasTables) {
          const imageArea = this.resolveImageArea(slideDef, usedSlotElements);
          this.deleteDecorativeShapesInImageArea(slideDef, imageArea, requests);
        }

        for (
          let i = 0;
          i < Math.min(bodySlots.length, this.slide.bodies.length);
          i++
        ) {
          const objectId = resolveSlotObjectId(
            this.presentation,
            this.slide.objectId,
            bodySlots[i]
          );
          if (objectId && this.slide.bodies[i].text) {
            this.appendInsertTextRequests(
              this.slide.bodies[i].text!,
              {objectId},
              requests
            );
          }
          // Images in template body — place in free slide area, not the text box
          if (this.slide.bodies[i].images?.length) {
            const imageBox = this.resolveImageArea(slideDef, usedSlotElements);
            this.appendCreateImageRequests(
              this.slide.bodies[i].images,
              imageBox,
              requests
            );
          }
        }
        // Tables in template slides — position within body area
        if (this.slide.tables.length) {
          const tableBox = this.resolveImageArea(slideDef, usedSlotElements);
          this.appendCreateTableRequests(this.slide.tables, requests, tableBox);
        }
      }
      // Background image
      if (this.slide.backgroundImage) {
        this.appendSetBackgroundImageRequest(
          this.slide.backgroundImage,
          requests
        );
      }
      // Notes
      if (this.slide.notes) {
        assert(this.slide.objectId);
        const objectId = findSpeakerNotesObjectId(
          this.presentation,
          this.slide.objectId
        );
        this.appendInsertTextRequests(
          this.slide.notes,
          {objectId: objectId},
          requests
        );
      }
      return requests;
    }

    this.appendFillPlaceholderTextRequest(this.slide.title, 'TITLE', requests);
    this.appendFillPlaceholderTextRequest(
      this.slide.title,
      'CENTERED_TITLE',
      requests
    );
    this.appendFillPlaceholderTextRequest(
      this.slide.subtitle,
      'SUBTITLE',
      requests
    );

    if (this.slide.backgroundImage) {
      this.appendSetBackgroundImageRequest(
        this.slide.backgroundImage,
        requests
      );
    }

    if (this.slide.tables.length) {
      this.appendCreateTableRequests(this.slide.tables, requests);
    }

    if (this.slide.bodies) {
      assert(this.slide.objectId);
      const bodyElements = findPlaceholder(
        this.presentation,
        this.slide.objectId,
        'BODY'
      );
      const bodyCount = Math.min(
        bodyElements?.length ?? 0,
        this.slide.bodies.length
      );
      for (let i = 0; i < bodyCount; ++i) {
        const placeholder = bodyElements![i];
        const body = this.slide.bodies[i];
        this.appendFillPlaceholderTextRequest(body.text, placeholder, requests);
        if (body.images && body.images.length) {
          this.appendCreateImageRequests(body.images, placeholder, requests);
        }
        if (body.videos && body.videos.length) {
          this.appendCreateVideoRequests(body.videos, placeholder, requests);
        }
      }
    }

    if (this.slide.notes) {
      assert(this.slide.objectId);
      const objectId = findSpeakerNotesObjectId(
        this.presentation,
        this.slide.objectId
      );
      this.appendInsertTextRequests(
        this.slide.notes,
        {objectId: objectId},
        requests
      );
    }

    return requests;
  }

  protected appendFillPlaceholderTextRequest(
    value: TextDefinition | undefined,
    placeholder: string | SlidesV1.Schema$PageElement,
    requests: SlidesV1.Schema$Request[]
  ): void {
    if (!value) {
      debug('No text for placeholder %s');
      return;
    }

    if (typeof placeholder === 'string') {
      assert(this.slide.objectId);
      const pageElements = findPlaceholder(
        this.presentation,
        this.slide.objectId,
        placeholder
      );
      if (!pageElements) {
        debug('Skipping undefined placeholder %s', placeholder);
        return;
      }
      placeholder = pageElements[0];
    }

    this.appendInsertTextRequests(
      value,
      {objectId: placeholder.objectId},
      requests
    );
  }

  private deleteDecorativeShapesInImageArea(
    slideDef: {slots?: Record<string, ManifestSlotDef>},
    imageArea: BoundingBox,
    requests: SlidesV1.Schema$Request[]
  ): void {
    assert(this.slide.objectId);
    const page = findPage(this.presentation, this.slide.objectId);
    if (!page?.pageElements) {
      return;
    }
    const usedIndices = new Set<number>();
    if (slideDef.slots) {
      for (const slotDef of Object.values(slideDef.slots)) {
        usedIndices.add(slotDef.element_index);
      }
    }
    for (let idx = 0; idx < page.pageElements.length; idx++) {
      if (usedIndices.has(idx)) {
        continue;
      }
      const el = page.pageElements[idx];
      if (
        !el.objectId ||
        !el.size?.width?.magnitude ||
        !el.size?.height?.magnitude
      ) {
        continue;
      }
      const elBox = this.calculateBoundingBox(el);
      if (this.boxesOverlap(elBox, imageArea)) {
        requests.push({
          deleteObject: {objectId: el.objectId},
        });
      }
    }
  }

  private boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  private clearUnusedTextBoxes(
    slideDef: {slots?: Record<string, ManifestSlotDef>},
    requests: SlidesV1.Schema$Request[]
  ): void {
    assert(this.slide.objectId);
    const page = findPage(this.presentation, this.slide.objectId);
    if (!page?.pageElements) {
      return;
    }
    // Collect ALL element indices mapped to manifest slots — never clear these
    const usedIndices = new Set<number>();
    if (slideDef.slots) {
      for (const slotDef of Object.values(slideDef.slots)) {
        usedIndices.add(slotDef.element_index);
      }
    }
    // Clear text in all text boxes NOT mapped to used slots
    for (let idx = 0; idx < page.pageElements.length; idx++) {
      if (usedIndices.has(idx)) {
        continue;
      }
      const el = page.pageElements[idx];
      if (el.shape?.text?.textElements && el.objectId) {
        if (this.hasTextContent(el.objectId)) {
          requests.push({
            deleteText: {
              objectId: el.objectId,
              textRange: {type: 'ALL'},
            },
          });
        }
      }
    }
  }

  private extractBaseTextStyle(
    objectId: string
  ): SlidesV1.Schema$TextStyle | undefined {
    if (!this.presentation.slides) {
      return undefined;
    }
    for (const slide of this.presentation.slides) {
      for (const el of slide.pageElements ?? []) {
        if (el.objectId === objectId && el.shape?.text?.textElements) {
          for (const te of el.shape.text.textElements) {
            if (te.textRun?.style) {
              return {...te.textRun.style};
            }
          }
        }
      }
    }
    return undefined;
  }

  private hasTextContent(objectId: string): boolean {
    if (!this.presentation.slides) {
      return false;
    }
    for (const slide of this.presentation.slides) {
      for (const el of slide.pageElements ?? []) {
        if (el.objectId === objectId && el.shape?.text?.textElements) {
          return el.shape.text.textElements.some(
            te => te.textRun?.content && te.textRun.content.trim().length > 0
          );
        }
      }
    }
    return false;
  }

  protected appendInsertTextRequests(
    text: TextDefinition,
    locationProps:
      | Partial<SlidesV1.Schema$UpdateTextStyleRequest>
      | Partial<SlidesV1.Schema$CreateParagraphBulletsRequest>,
    requests: SlidesV1.Schema$Request[]
  ): void {
    // Clear existing placeholder text on cloned template slides
    if (this.slide.templateSlide !== undefined && locationProps.objectId) {
      if (this.hasTextContent(locationProps.objectId)) {
        requests.push({
          deleteText: {
            objectId: locationProps.objectId,
            textRange: {type: 'ALL'},
          },
        });
      }
    }

    // Insert the raw text first
    const request = {
      insertText: extend(
        {
          text: text.rawText,
        },
        locationProps
      ),
    };
    requests.push(request);

    // Apply template base text style to preserve branded typography
    if (this.slide.templateSlide !== undefined && locationProps.objectId) {
      const baseStyle = this.extractBaseTextStyle(locationProps.objectId);
      if (baseStyle) {
        // Remove content and link fields — only keep visual styling
        delete baseStyle.link;
        delete baseStyle.weightedFontFamily;
        const baseFields = this.computeShallowFieldMask(baseStyle);
        if (baseFields.length) {
          requests.push({
            updateTextStyle: extend(
              {
                textRange: {
                  type: 'FIXED_RANGE',
                  startIndex: 0,
                  endIndex: text.rawText.length,
                },
                style: baseStyle,
                fields: baseFields,
              },
              locationProps
            ),
          });
        }
      }
    }

    // Apply any text styles present.
    // Most of the work for generating the text runs
    // is performed when parsing markdown.
    for (const textRun of text.textRuns) {
      const request: SlidesV1.Schema$Request = {
        updateTextStyle: extend(
          {
            textRange: {
              type: 'FIXED_RANGE',
              startIndex: textRun.start,
              endIndex: textRun.end,
            },
            style: {
              bold: textRun.bold,
              italic: textRun.italic,
              foregroundColor: textRun.foregroundColor,
              backgroundColor: textRun.backgroundColor,
              strikethrough: textRun.strikethrough,
              underline: textRun.underline,
              smallCaps: textRun.smallCaps,
              fontFamily: textRun.fontFamily,
              fontSize: textRun.fontSize,
              link: textRun.link,
              baselineOffset: textRun.baselineOffset,
            },
          },
          locationProps
        ),
      };
      assert(request.updateTextStyle?.style);
      request.updateTextStyle.fields = this.computeShallowFieldMask(
        request.updateTextStyle.style
      );
      if (request.updateTextStyle.fields.length) {
        requests.push(request); // Only push if at least one style set
      }
    }

    // Convert paragraphs to lists.
    // Note that leading tabs for nested lists in the raw text are removed.
    // In this case, we're assuming that lists are supplied in order of
    // appearance and they're non-overlapping.
    // Processing in the reverse order avoids having to readjust indices.
    for (const listMarker of _.reverse(text.listMarkers)) {
      const request = {
        createParagraphBullets: extend(
          {
            textRange: {
              type: 'FIXED_RANGE',
              startIndex: listMarker.start,
              endIndex: listMarker.end,
            },
            bulletPreset:
              listMarker.type === 'ordered'
                ? 'NUMBERED_DIGIT_ALPHA_ROMAN'
                : 'BULLET_DISC_CIRCLE_SQUARE',
          },
          locationProps
        ),
      };
      requests.push(request);
    }
  }

  protected appendSetBackgroundImageRequest(
    image: ImageDefinition,
    requests: SlidesV1.Schema$Request[]
  ): void {
    debug(
      'Slide #%d: setting background image to %s',
      this.slide.index,
      image.url
    );

    requests.push({
      updatePageProperties: {
        objectId: this.slide.objectId,
        fields: 'pageBackgroundFill.stretchedPictureFill.contentUrl',
        pageProperties: {
          pageBackgroundFill: {
            stretchedPictureFill: {
              contentUrl: image.url,
            },
          },
        },
      },
    });
  }

  protected appendCreateImageRequests(
    images: ImageDefinition[],
    placeholderOrBox: SlidesV1.Schema$PageElement | BoundingBox | undefined,
    requests: SlidesV1.Schema$Request[]
  ): void {
    // TODO - Fix weird cast
    const layer = (Layout as (s: string) => Layout.PackingSmith)('left-right'); // TODO - Configurable?
    for (const image of images) {
      debug('Slide #%d: adding inline image %s', this.slide.index, image.url);
      layer.addItem({
        width: image.width + image.padding * 2,
        height: image.height + image.padding * 2,
        meta: image,
      });
    }

    const box = this.resolveImageBox(placeholderOrBox);
    const computedLayout = layer.export();

    const scaleRatio = Math.min(
      box.width / computedLayout.width,
      box.height / computedLayout.height
    );

    const scaledWidth = computedLayout.width * scaleRatio;
    const scaledHeight = computedLayout.height * scaleRatio;

    const baseTranslateX = box.x + (box.width - scaledWidth) / 2;
    const baseTranslateY = box.y + (box.height - scaledHeight) / 2;

    for (const item of computedLayout.items) {
      const itemOffsetX = item.meta.offsetX ? item.meta.offsetX : 0;
      const itemOffsetY = item.meta.offsetY ? item.meta.offsetY : 0;
      const itemPadding = item.meta.padding ? item.meta.padding : 0;
      const width = item.meta.width * scaleRatio;
      const height = item.meta.height * scaleRatio;
      const translateX =
        baseTranslateX + (item.x + itemPadding + itemOffsetX) * scaleRatio;
      const translateY =
        baseTranslateY + (item.y + itemPadding + itemOffsetY) * scaleRatio;

      requests.push({
        createImage: {
          elementProperties: {
            pageObjectId: this.slide.objectId,
            size: {
              height: {
                magnitude: height,
                unit: 'EMU',
              },
              width: {
                magnitude: width,
                unit: 'EMU',
              },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: translateX,
              translateY: translateY,
              shearX: 0,
              shearY: 0,
              unit: 'EMU',
            },
          },
          url: item.meta.url,
        },
      });
    }
  }

  protected appendCreateVideoRequests(
    videos: VideoDefinition[],
    placeholder: SlidesV1.Schema$PageElement | undefined,
    requests: SlidesV1.Schema$Request[]
  ): void {
    if (videos.length > 1) {
      throw new Error('Multiple videos per slide are not supported.');
    }
    const video = videos[0];

    debug('Slide #%d: adding video %s', this.slide.index, video.id);

    const box = this.getBodyBoundingBox(placeholder);

    const scaleRatio = Math.min(
      box.width / video.width,
      box.height / video.height
    );

    const scaledWidth = video.width * scaleRatio;
    const scaledHeight = video.height * scaleRatio;

    const translateX = box.x + (box.width - scaledWidth) / 2;
    const translateY = box.y + (box.height - scaledHeight) / 2;

    const objectId = uuid();
    requests.push({
      createVideo: {
        source: 'YOUTUBE',
        objectId: objectId,
        id: video.id,
        elementProperties: {
          pageObjectId: this.slide.objectId,
          size: {
            height: {
              magnitude: scaledHeight,
              unit: 'EMU',
            },
            width: {
              magnitude: scaledWidth,
              unit: 'EMU',
            },
          },
          transform: {
            scaleX: 1,
            scaleY: 1,
            translateX: translateX,
            translateY: translateY,
            shearX: 0,
            shearY: 0,
            unit: 'EMU',
          },
        },
      },
    });
    requests.push({
      updateVideoProperties: {
        objectId: objectId,
        fields: 'autoPlay',
        videoProperties: {
          autoPlay: video.autoPlay,
        },
      },
    });
  }

  protected appendCreateTableRequests(
    tables: TableDefinition[],
    requests: SlidesV1.Schema$Request[],
    constraintBox?: BoundingBox
  ): void {
    if (tables.length > 1) {
      throw new Error('Multiple tables per slide are not supported.');
    }
    const table = tables[0];
    const tableId = uuid();

    const elementProperties: SlidesV1.Schema$PageElementProperties = {
      pageObjectId: this.slide.objectId,
    };

    if (constraintBox && constraintBox.width > 0 && constraintBox.height > 0) {
      elementProperties.size = {
        width: {magnitude: constraintBox.width, unit: 'EMU'},
        height: {magnitude: constraintBox.height, unit: 'EMU'},
      };
      elementProperties.transform = {
        scaleX: 1,
        scaleY: 1,
        translateX: constraintBox.x,
        translateY: constraintBox.y,
        shearX: 0,
        shearY: 0,
        unit: 'EMU',
      };
    }

    requests.push({
      createTable: {
        objectId: tableId,
        elementProperties,
        rows: table.rows,
        columns: table.columns,
      },
    });

    for (const r in table.cells) {
      const row = table.cells[r];
      for (const c in row) {
        this.appendInsertTextRequests(
          row[c],
          {
            objectId: tableId,
            cellLocation: {
              rowIndex: parseInt(r),
              columnIndex: parseInt(c),
            },
          },
          requests
        );
      }
    }
  }

  protected calculateBoundingBox(
    element: SlidesV1.Schema$PageElement
  ): BoundingBox {
    assert(element);
    assert(element.size?.height?.magnitude);
    assert(element.size?.width?.magnitude);
    const height = element.size.height.magnitude;
    const width = element.size.width.magnitude;
    const scaleX = element.transform?.scaleX ?? 1;
    const scaleY = element.transform?.scaleY ?? 1;
    const shearX = element.transform?.shearX ?? 0;
    const shearY = element.transform?.shearY ?? 0;

    return {
      width: scaleX * width + shearX * height,
      height: scaleY * height + shearY * width,
      x: element.transform?.translateX ?? 0,
      y: element.transform?.translateY ?? 0,
    };
  }

  protected getBodyBoundingBox(
    placeholder: SlidesV1.Schema$PageElement | undefined
  ): BoundingBox {
    if (placeholder) {
      return this.calculateBoundingBox(placeholder);
    }
    assert(this.presentation.pageSize?.width?.magnitude);
    assert(this.presentation.pageSize?.height?.magnitude);
    return {
      width: this.presentation.pageSize.width.magnitude,
      height: this.presentation.pageSize.height.magnitude,
      x: 0,
      y: 0,
    };
  }

  /**
   * Resolves image placement box from either a pre-computed BoundingBox,
   * a page element, or falls back to full page size.
   */
  private resolveImageBox(
    placeholderOrBox: SlidesV1.Schema$PageElement | BoundingBox | undefined
  ): BoundingBox {
    if (!placeholderOrBox) {
      return this.getBodyBoundingBox(undefined);
    }
    // Already a BoundingBox
    if (
      'x' in placeholderOrBox &&
      'width' in placeholderOrBox &&
      !('objectId' in placeholderOrBox)
    ) {
      return placeholderOrBox as BoundingBox;
    }
    return this.getBodyBoundingBox(
      placeholderOrBox as SlidesV1.Schema$PageElement
    );
  }

  /**
   * Resolves the image/table placement area for a template slide.
   * Uses manifest image_area if specified, otherwise computes free area.
   */
  protected resolveImageArea(
    slideDef: ManifestSlideDef,
    usedElements: SlidesV1.Schema$PageElement[]
  ): BoundingBox {
    if (slideDef.image_area) {
      return slideDef.image_area;
    }
    return this.computeImageArea(usedElements);
  }

  /**
   * Computes the free area on a template slide not occupied by used slot
   * elements. Picks the larger of the space to the right of all slots
   * or the space below all slots.
   */
  protected computeImageArea(
    usedElements: SlidesV1.Schema$PageElement[]
  ): BoundingBox {
    assert(this.presentation.pageSize?.width?.magnitude);
    assert(this.presentation.pageSize?.height?.magnitude);

    const pageWidth = this.presentation.pageSize.width.magnitude;
    const pageHeight = this.presentation.pageSize.height.magnitude;

    if (usedElements.length === 0) {
      return {width: pageWidth, height: pageHeight, x: 0, y: 0};
    }

    let maxRight = 0;
    let maxBottom = 0;
    let minLeft = pageWidth;
    let minTop = pageHeight;

    for (const el of usedElements) {
      const box = this.calculateBoundingBox(el);
      maxRight = Math.max(maxRight, box.x + box.width);
      maxBottom = Math.max(maxBottom, box.y + box.height);
      minLeft = Math.min(minLeft, box.x);
      minTop = Math.min(minTop, box.y);
    }

    // Use the left margin of the text elements as spacing
    const gap = minLeft;

    const rightArea: BoundingBox = {
      x: maxRight + gap,
      y: minTop,
      width: pageWidth - maxRight - gap - minLeft,
      height: pageHeight - minTop - gap,
    };

    const bottomArea: BoundingBox = {
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
    return {width: pageWidth, height: pageHeight, x: 0, y: 0};
  }

  protected computeShallowFieldMask<T>(object: T): string {
    const fields = [];
    for (const field of Object.keys(object)) {
      if (object[field as keyof T] !== undefined) {
        fields.push(field);
      }
    }
    return fields.join(',');
  }
}
