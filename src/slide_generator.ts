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
import extractSlides from './parser/extract_slides';
import {SlideDefinition, ImageDefinition} from './slides';
import matchLayout from './layout/match_layout';
import {TemplateManifest} from './layout/template_manifest';
import {uuid} from './utils';
import {URL} from 'url';
import {google, slides_v1 as SlidesV1} from 'googleapis';
import uploadLocalImage from './images/upload';
import {OAuth2Client} from 'google-auth-library';
import probeImage from './images/probe';
import maybeGenerateImage from './images/generate';
import assert from 'assert';

const debug = Debug('md2gslides');

/**
 * Generates slides from Markdown or HTML. Requires an authorized
 * oauth2 client.
 *
 * @example
 *
 *   var SlideGenerator = require('md2slides');
 *   var fs = require('fs');
 *
 *   var oauth2Client = ...; // See Google API client for details
 *   var generator = SlideGenerator.newPresentation(oauth2Client);
 *   var markdown = fs.readFileSync('mydeck.md');
 *   generator.generateFromMarkdown(markdown).then(function(id) {
 *     console.log("Presentation ID: " + id);
 *   });
 *
 * @see https://github.com/google/google-api-nodejs-client
 */
export default class SlideGenerator {
  private slides: SlideDefinition[] = [];
  private api: SlidesV1.Slides;
  private presentation: SlidesV1.Schema$Presentation;
  private allowUpload = false;
  private templateSlideIds: string[] = [];
  private masterObjectId?: string;
  private manifest?: TemplateManifest;
  /**
   * @param {Object} api Authorized API client instance
   * @param {Object} presentation Initial presentation data
   * @private
   */
  public constructor(
    api: SlidesV1.Slides,
    presentation: SlidesV1.Schema$Presentation
  ) {
    this.api = api;
    this.presentation = presentation;
  }

  public setManifest(manifest: TemplateManifest): void {
    this.manifest = manifest;
  }

  /**
   * Returns a generator that writes to a new blank presentation.
   *
   * @param {OAuth2Client} oauth2Client User credentials
   * @param {string} title Title of presentation
   * @returns {Promise.<SlideGenerator>}
   */
  public static async newPresentation(
    oauth2Client: OAuth2Client,
    title: string
  ): Promise<SlideGenerator> {
    const api = google.slides({version: 'v1', auth: oauth2Client});
    const res = await api.presentations.create({
      requestBody: {
        title: title,
      },
    });
    const presentation = res.data;
    return new SlideGenerator(api, presentation);
  }

  /**
   * Returns a generator that copies an existing presentation.
   *
   * @param {OAuth2Client} oauth2Client User credentials
   * @param {string} title Title of presentation
   * @param {string} presentationId ID of presentation to copy
   * @returns {Promise.<SlideGenerator>}
   */
  public static async copyPresentation(
    oauth2Client: OAuth2Client,
    title: string,
    presentationId: string
  ): Promise<SlideGenerator> {
    const drive = google.drive({version: 'v3', auth: oauth2Client});
    const res = await drive.files.copy({
      fileId: presentationId,
      requestBody: {
        name: title,
      },
    });
    assert(res.data.id);
    return SlideGenerator.forPresentation(oauth2Client, res.data.id);
  }

  /**
   * Returns a generator that copies a template presentation and uses
   * its branded master for layout matching.
   *
   * @param {OAuth2Client} oauth2Client User credentials
   * @param {string} title Title of presentation
   * @param {string} templateId ID of template presentation to copy
   * @returns {Promise.<SlideGenerator>}
   */
  public static async fromTemplate(
    oauth2Client: OAuth2Client,
    title: string,
    templateId: string
  ): Promise<SlideGenerator> {
    const drive = google.drive({version: 'v3', auth: oauth2Client});
    const res = await drive.files.copy({
      fileId: templateId,
      requestBody: {
        name: title,
      },
    });
    assert(res.data.id);
    const generator = await SlideGenerator.forPresentation(
      oauth2Client,
      res.data.id
    );
    // Record template slide IDs for later cloning
    generator.templateSlideIds = (generator.presentation.slides ?? []).map(
      s => {
        assert(s.objectId);
        return s.objectId;
      }
    );
    // Pick the last master (the custom/branded one in multi-master templates)
    // Defer actual deletion to after template slides are cloned, since
    // deleting a master invalidates slides associated with it.
    const masters = generator.presentation.masters;
    if (masters && masters.length > 1) {
      const preferredMaster = masters[masters.length - 1];
      generator.masterObjectId = preferredMaster.objectId ?? undefined;
      debug(
        'Using master %s (%d other master(s) present)',
        preferredMaster.objectId,
        masters.length - 1
      );
    }
    return generator;
  }

  /**
   * Returns a generator that writes to an existing presentation.
   *
   * @param {OAuth2Client} oauth2Client User credentials
   * @param {string} presentationId ID of presentation to use
   * @returns {Promise.<SlideGenerator>}
   */
  public static async forPresentation(
    oauth2Client: OAuth2Client,
    presentationId: string
  ): Promise<SlideGenerator> {
    const api = google.slides({version: 'v1', auth: oauth2Client});
    const res = await api.presentations.get({presentationId: presentationId});
    const presentation = res.data;
    return new SlideGenerator(api, presentation);
  }

  /**
   * Generate slides from markdown
   *
   * @param {String} markdown Markdown to import
   * @param css
   * @param useFileio
   * @returns {Promise.<String>} ID of generated slide
   */
  public async generateFromMarkdown(
    markdown: string,
    {css, useFileio}: {css: string; useFileio: boolean}
  ): Promise<string> {
    assert(this.presentation?.presentationId);
    this.slides = extractSlides(markdown, css).slides;
    this.validateTemplateSlides();
    this.allowUpload = useFileio;
    await this.generateImages();
    await this.probeImageSizes();
    await this.uploadLocalImages();
    if (this.templateSlideIds.length > 0) {
      // Template mode: clone first, then clean up, then create remaining
      await this.updatePresentation(this.cloneTemplateSlides());
      await this.deleteTemplateSlides();
      // After deleting template slides, the branded master may be gone.
      // Clear masterObjectId so new slides use whatever master remains.
      this.masterObjectId = undefined;
      await this.reloadPresentation();
      await this.updatePresentation(this.createNewSlides());
      await this.reorderSlides();
    } else {
      await this.updatePresentation(this.createSlides());
    }
    await this.reloadPresentation();
    await this.updatePresentation(this.populateSlides());
    return this.presentation.presentationId;
  }

  /**
   * Removes any existing slides from the presentation.
   *
   * @returns {Promise.<*>}
   */
  public async erase(): Promise<void> {
    debug('Erasing previous slides');
    assert(this.presentation?.presentationId);
    if (!this.presentation.slides) {
      return Promise.resolve();
    }

    const requests = this.presentation.slides.map(slide => ({
      deleteObject: {
        objectId: slide.objectId,
      },
    }));
    const batch = {requests};
    await this.api.presentations.batchUpdate({
      presentationId: this.presentation.presentationId,
      requestBody: batch,
    });
  }

  protected validateTemplateSlides(): void {
    for (const slide of this.slides) {
      if (slide.templateSlide !== undefined) {
        if (this.templateSlideIds.length === 0) {
          throw new Error(
            '{template_slide=N} requires --template flag'
          );
        }
        if (
          slide.templateSlide < 1 ||
          slide.templateSlide > this.templateSlideIds.length
        ) {
          throw new Error(
            `template_slide=${slide.templateSlide} is out of range ` +
              `(template has ${this.templateSlideIds.length} slides)`
          );
        }
      }
    }
  }

  protected async deleteTemplateSlides(): Promise<void> {
    assert(this.presentation?.presentationId);
    const requests: SlidesV1.Schema$Request[] = [];

    // Delete all original template slides
    for (const id of this.templateSlideIds) {
      requests.push({deleteObject: {objectId: id}});
    }

    await this.updatePresentation({requests});
  }

  protected async reorderSlides(): Promise<void> {
    await this.reloadPresentation();
    // Each position update shifts indices, so send them individually
    for (let i = 0; i < this.slides.length; i++) {
      const slideId = this.slides[i].objectId;
      if (slideId) {
        await this.updatePresentation({
          requests: [
            {
              updateSlidesPosition: {
                slideObjectIds: [slideId],
                insertionIndex: i,
              },
            },
          ],
        });
      }
    }
  }

  protected async processImages<T>(
    fn: (img: ImageDefinition) => Promise<T>
  ): Promise<void> {
    const promises = [];
    for (const slide of this.slides) {
      if (slide.backgroundImage) {
        promises.push(fn(slide.backgroundImage));
      }
      for (const body of slide.bodies) {
        for (const image of body.images) {
          promises.push(fn(image));
        }
      }
    }
    await Promise.all(promises);
  }
  protected async generateImages(): Promise<void> {
    return this.processImages(maybeGenerateImage);
  }

  protected async uploadLocalImages(): Promise<void> {
    const uploadImageifLocal = async (
      image: ImageDefinition
    ): Promise<void> => {
      assert(image.url);
      const parsedUrl = new URL(image.url);
      if (parsedUrl.protocol !== 'file:') {
        return;
      }
      if (!this.allowUpload) {
        return Promise.reject('Local images require --use-fileio option');
      }
      image.url = await uploadLocalImage(parsedUrl.pathname);
    };
    return this.processImages(uploadImageifLocal);
  }

  /**
   * Fetches the image sizes for each image in the presentation. Allows
   * for more accurate layout of images.
   *
   * Image sizes are stored as data attributes on the image elements.
   *
   * @returns {Promise.<*>}
   * @private
   */
  protected async probeImageSizes(): Promise<void> {
    return this.processImages(probeImage);
  }

  /**
   * 1st pass at generation -- creates slides using the apporpriate
   * layout based on the content.
   *
   * Note this only returns the batch requests, but does not execute it.
   *
   * @returns {{requests: Array}}
   */
  protected cloneTemplateSlides(): SlidesV1.Schema$BatchUpdatePresentationRequest {
    debug('Cloning template slides');
    const batch: SlidesV1.Schema$BatchUpdatePresentationRequest = {
      requests: [],
    };
    for (const slide of this.slides) {
      if (slide.templateSlide !== undefined) {
        const templateIndex = slide.templateSlide - 1; // 1-based to 0-based
        const sourceObjectId = this.templateSlideIds[templateIndex];
        const newObjectId = uuid();
        slide.objectId = newObjectId;
        debug(
          'Cloning template slide %d (%s) as %s',
          slide.templateSlide,
          sourceObjectId,
          newObjectId
        );
        batch.requests!.push({
          duplicateObject: {
            objectId: sourceObjectId,
            objectIds: {[sourceObjectId]: newObjectId},
          },
        });
      }
    }
    return batch;
  }

  protected createNewSlides(): SlidesV1.Schema$BatchUpdatePresentationRequest {
    debug('Creating new slides');
    const batch: SlidesV1.Schema$BatchUpdatePresentationRequest = {
      requests: [],
    };
    for (const slide of this.slides) {
      if (slide.templateSlide === undefined) {
        const layout = matchLayout(
          this.presentation,
          slide,
          this.masterObjectId
        );
        layout.appendCreateSlideRequest(batch.requests!);
      }
    }
    return batch;
  }

  protected createSlides(): SlidesV1.Schema$BatchUpdatePresentationRequest {
    debug('Creating slides');
    const batch: SlidesV1.Schema$BatchUpdatePresentationRequest = {
      requests: [],
    };
    for (const slide of this.slides) {
      const layout = matchLayout(
        this.presentation,
        slide,
        this.masterObjectId
      );
      layout.appendCreateSlideRequest(batch.requests!);
    }
    return batch;
  }

  /**
   * 2nd pass at generation -- fills in placeholders and adds any other
   * elements to the slides.
   *
   * Note this only returns the batch requests, but does not execute it.
   *
   * @returns {{requests: Array}}
   */
  protected populateSlides(): SlidesV1.Schema$BatchUpdatePresentationRequest {
    debug('Populating slides');
    const batch = {
      requests: [],
    };
    for (const slide of this.slides) {
      const layout = matchLayout(
        this.presentation,
        slide,
        this.masterObjectId,
        this.manifest
      );
      layout.appendContentRequests(batch.requests);
    }
    return batch;
  }

  /**
   * Updates the remote presentation.
   *
   * @param batch Batch of operations to execute
   * @returns {Promise.<*>}
   */
  protected async updatePresentation(
    batch: SlidesV1.Schema$BatchUpdatePresentationRequest
  ): Promise<void> {
    debug('Updating presentation: %O', batch);
    assert(this.presentation?.presentationId);
    if (!batch.requests || batch.requests.length === 0) {
      return Promise.resolve();
    }
    const res = await this.api.presentations.batchUpdate({
      presentationId: this.presentation.presentationId,
      requestBody: batch,
    });
    debug('API response: %O', res.data);
  }

  /**
   * Refreshes the local copy of the presentation.
   *
   * @returns {Promise.<*>}
   */
  protected async reloadPresentation(): Promise<void> {
    assert(this.presentation?.presentationId);
    const res = await this.api.presentations.get({
      presentationId: this.presentation.presentationId,
    });
    this.presentation = res.data;
  }
}
