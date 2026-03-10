import chai from 'chai';
import {extractFrontmatter} from '../src/parser/parser';

const expect = chai.expect;

describe('extractFrontmatter', () => {
  it('should return null frontmatter for content without frontmatter', () => {
    const input = '# Hello\n\nSome content';
    const result = extractFrontmatter(input);
    expect(result.frontmatter).to.be.null;
    expect(result.content).to.equal(input);
  });

  it('should parse valid YAML frontmatter', () => {
    const input =
      '---\nid: abc123\ntitle: My Deck\ntemplate: tmpl-id\nmanifest: manifest.yaml\n---\n# Hello';
    const result = extractFrontmatter(input);
    expect(result.frontmatter).to.deep.equal({
      id: 'abc123',
      title: 'My Deck',
      template: 'tmpl-id',
      manifest: 'manifest.yaml',
    });
    expect(result.content).to.equal('# Hello');
  });

  it('should return content after frontmatter delimiter', () => {
    const input =
      '---\ntitle: Test\n---\n# Slide 1\n\nBody text\n\n---\n\n# Slide 2';
    const result = extractFrontmatter(input);
    expect(result.frontmatter).to.deep.equal({title: 'Test'});
    expect(result.content).to.equal(
      '# Slide 1\n\nBody text\n\n---\n\n# Slide 2'
    );
  });

  it('should handle Windows line endings', () => {
    const input = '---\r\ntitle: Test\r\n---\r\n# Hello\r\nWorld';
    const result = extractFrontmatter(input);
    expect(result.frontmatter).to.deep.equal({title: 'Test'});
    expect(result.content).to.equal('# Hello\r\nWorld');
  });

  it('should return null frontmatter for invalid YAML', () => {
    const input = '---\n: [invalid yaml\n---\n# Hello';
    const result = extractFrontmatter(input);
    expect(result.frontmatter).to.be.null;
    expect(result.content).to.equal(input);
  });

  it('should return null frontmatter for unclosed frontmatter block', () => {
    const input = '---\ntitle: Test\n# Hello';
    const result = extractFrontmatter(input);
    expect(result.frontmatter).to.be.null;
    expect(result.content).to.equal(input);
  });
});
