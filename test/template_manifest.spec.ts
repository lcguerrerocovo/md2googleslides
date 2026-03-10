import chai from 'chai';
import {resolveSlideNameToNumber} from '../src/layout/template_manifest';
import type {TemplateManifest} from '../src/layout/template_manifest';

const expect = chai.expect;

describe('resolveSlideNameToNumber', () => {
  const manifest: TemplateManifest = {
    template_id: 'test-template',
    slides: {
      8: {name: 'Title slide', slots: {title: {element_index: 1}}},
      27: {
        name: 'Content slide',
        slots: {title: {element_index: 0}, body: {element_index: 1}},
      },
      38: {name: 'Highlight', slots: {body: {element_index: 0}}},
      103: {},
    },
  };

  it('should resolve exact name match to slide number', () => {
    expect(resolveSlideNameToNumber(manifest, 'Title slide')).to.equal(8);
    expect(resolveSlideNameToNumber(manifest, 'Content slide')).to.equal(27);
    expect(resolveSlideNameToNumber(manifest, 'Highlight')).to.equal(38);
  });

  it('should throw on unknown name with available names listed', () => {
    expect(() => resolveSlideNameToNumber(manifest, 'Nonexistent')).to.throw(
      /Unknown template slide name "Nonexistent"/
    );
    expect(() => resolveSlideNameToNumber(manifest, 'Nonexistent')).to.throw(
      /Available: "Title slide", "Content slide", "Highlight"/
    );
  });

  it('should handle manifest with no named slides', () => {
    const emptyManifest: TemplateManifest = {
      template_id: 'test',
      slides: {
        1: {},
        2: {},
      },
    };
    expect(() => resolveSlideNameToNumber(emptyManifest, 'Any')).to.throw(
      /Unknown template slide name "Any"/
    );
  });
});
