Generate Google Slides from markdown & HTML. Run from the command line or embed in another
application.

## Fork history

This project is a fork of [googleworkspace/md2googleslides](https://github.com/googleworkspace/md2googleslides),
which was developed by Google as an example of how to use the
[Slides API](https://developers.google.com/slides). The original project is no longer maintained
and does not work out of the box due to outdated dependencies, API changes, and broken auth.

Auth and dependency fixes were ported from [@wescpy/md2gslides](https://www.npmjs.com/package/@wescpy/md2gslides),
a community fork by Wesley Chun that patched many of these issues. Thanks to Wesley for keeping
the tool alive.

## Installation and usage

For command line use, install md2gslides globally:

```sh
npm install -g md2gslides
```

Then get your OAuth client ID credentials:

* Create (or reuse) a developer project at <https://console.developers.google.com>
* Enable Google Slides API at [API library page](https://console.developers.google.com/apis/library)
* Go to [Credentials page](https://console.developers.google.com/apis/credentials) and click "+ Create credentials" at the top
* Select "OAuth client ID" authorization credentials
* Choose type "Computer Application" and give it some name.
* Download client credentials file.
* Copy it to `client_id.json` (name has to match) and save to `~/.md2googleslides`.

After installing, import your slides by running:

```sh
md2gslides slides.md --title "Talk Title"
```

This will generate new Google Slides in your account with title `Talk Title`. 

NOTE: The first time the command is run you will be prompted for authorization. OAuth token
credentials are stored locally in a file named `~/.md2googleslides/credentials.json`.

Each time you run the above command, a new slide deck will be generated. For iterating on the same deck, use the **frontmatter workflow** (see below), which automatically manages the presentation ID.

## Frontmatter workflow

Instead of passing CLI flags, you can use YAML frontmatter in your markdown file. This is the recommended workflow for iterating on a deck.

### Frontmatter keys

| Key | Description |
|-----|-------------|
| `id` | Google Slides presentation ID (written back automatically after first run) |
| `title` | Presentation title |
| `template` | Template presentation ID to clone slides from |
| `manifest` | Path to YAML manifest file for template content filling |

### Example

<pre>
---
title: My Presentation
template: 1qBgj4pWhorq3Eoy1y6azLKGjBQXnU7tTtWV3W_tKY_o
manifest: dp-template-manifest.yaml
---

{template_slide="Title slide"}

# Welcome
## Getting started

---

{template_slide="Content slide"}

# Agenda

* Item one
* Item two
</pre>

### How it works

**First run:** Creates the deck (copying the template if specified), then writes the presentation `id` back into the markdown file's frontmatter. No CLI flags needed:

```sh
md2gslides slides.md
```

**Subsequent runs:** The same command updates the deck in place. For non-template decks, slides are erased and regenerated at the same URL. For template decks, a fresh copy is created from the template, the old deck is deleted, and the new ID is written back to the frontmatter.

### Name-based template slides

When using a manifest, you can reference template slides by name instead of number:

```
{template_slide="Title slide"}
```

The name is resolved via the manifest's `name` field for each slide entry. Run `--analyze-template` to generate a manifest with auto-assigned names.

## Template integration

Use `--template <ID>` to copy a Google Slides template and clone specific slides from it. This preserves all visual branding (backgrounds, shapes, logos, colors) from the template.

### Workflow

1. **Analyze the template** to discover text box positions:

```sh
md2gslides --analyze-template <TEMPLATE_ID> -p <project> > template-manifest.yaml
```

2. **Review and adjust the YAML manifest** — the output includes auto-classified slots. Use the `element_index` values and text box comments to verify:

```yaml
template_id: "<TEMPLATE_ID>"
slides:
  8:
    name: "Title slide"
    slots:
      title:
        element_index: 1
      subtitle:
        element_index: 2
  27:
    name: "Content slide"
    slots:
      title:
        element_index: 0
      body:
        element_index: 1
    image_area:
      x: 4572000
      y: 1200000
      width: 4000000
      height: 3400000
```

The `image_area` field defines where images and tables are placed on template slides (coordinates in EMU). When omitted, the tool computes a free area automatically based on text box positions. Run `--analyze-template` to auto-generate reasonable defaults, then adjust manually if needed.

3. **Reference template slides in markdown** using `{template_slide="Name"}` (or `{template_slide=N}` for 1-based numeric index):

<pre>
{template_slide="Title slide"}

# Presentation Title
## Subtitle goes here

---

{template_slide="Content slide"}

# Slide heading

Body content here
</pre>

4. **Generate the deck:**

```sh
md2gslides slides.md --template <TEMPLATE_ID> --manifest manifest.yaml -p <project> --title "My Deck"
```

Slides with `{template_slide="Name"}` (or `{template_slide=N}`) are cloned from the template with full visual branding. Slides without it are created with the default layout.

### Multi-project credentials

Use `-p <project>` or `--project <project>` to store OAuth credentials in a subdirectory under `~/.md2googleslides/<project>/`. This allows using different GCP projects for different templates or accounts.

## Supported markdown rules

md2gslides uses a subset of the [CommonMark](http://spec.commonmark.org/0.26/) and
[Github Flavored Markdown](https://help.github.com/categories/writing-on-github/) rules for
markdown.

### Slides

Each slide is typically represented by a header, followed by zero or more block elements.

Begin a new slide with a horizontal rule (`---`). The separator
may be omitted for the first slide.

The following examples show how to create slides of various layouts:

#### Title slide

<pre>
    ---

    # This is a title slide
    ## Your name here
</pre>

![Title slide](https://github.com/googlesamples/md2googleslides/raw/master/examples/title_slide.png)

#### Section title slides

<pre>
    ---

    # This is a section title
</pre>

![Section title slide](https://github.com/googlesamples/md2googleslides/raw/master/examples/section_title_slide.png)

#### Section title & body slides

<pre>
    ---

    # Section title & body slide

    ## This is a subtitle

    This is the body
</pre>

![Section title & body slide](https://github.com/googlesamples/md2googleslides/raw/master/examples/section_title_body_slide.png)

#### Title & body slides

<pre>
    ---

    # Title & body slide

    This is the slide body.
</pre>

![Title & body slide](https://github.com/googlesamples/md2googleslides/raw/master/examples/title_body_slide.png)

#### Main point slide

Add `{.big}` to the title to make a slide with one big point

<pre>
    ---

    # This is the main point {.big}
</pre>

![Main point slide](https://github.com/googlesamples/md2googleslides/raw/master/examples/main_point_slide.png)

#### Big number slide

Use `{.big}` on a header in combination with a body too.

<pre>
    ---

    # 100% {.big}

    This is the body
</pre>

![Big number slide](examples/big_number_slide.png)


#### Two column slides

Separate columns with `{.column}`. The marker must appear
on its own line with a blank both before and after.

<pre>
    ---

    # Two column layout

    This is the left column

    {.column}

    This is the right column
</pre>

![Two column slide](https://github.com/googlesamples/md2googleslides/raw/master/examples/two_column_slide.png)

### Themes

`md2googleslides` does not edit or control any theme related options. Just set a base theme you want on Google Slides directly.
The tool does not modify themes when updating an existing deck.

### Images

#### Inline images

Images can be placed on slides using image tags. Multiple images
can be included. Mulitple images in a single paragraph are arranged in columns,
mutiple paragraphs arranged as rows.

Note: Images are currently scaled and centered to fit the
slide template.

<pre>
    ---

    # Slides can have images

    ![](https://placekitten.com/900/900)
</pre>

![Slide with image](https://github.com/googlesamples/md2googleslides/raw/master/examples/image_slide.png)

#### Background images

Set the background image of a slide by adding `{.background}` to
the end of an image URL.

<pre>
    ---

    # Slides can have background images

    ![](https://placekitten.com/1600/900){.background}
</pre>

![Slide with background image](https://github.com/googlesamples/md2googleslides/raw/master/examples/background_image_slide.png)

### Videos

Include YouTube videos with a modified image tag.

<pre>
    ---

    # Slides can have videos

    @[youtube](MG8KADiRbOU)
</pre>

![Slide with video](https://github.com/googlesamples/md2googleslides/raw/master/examples/video_slide.png)

### Speaker notes

Include speaker notes for a slide using HTML comments. Text inside
the comments may include markdown for formatting, though only text
formatting is allowed. Videos, images, and tables are ignored inside
speaker notes.

<pre>
    ---

    # Slide title

    ![](https://placekitten.com/1600/900){.background}

    &lt;!--
    These are speaker notes.
    --&gt;
</pre>

### Formatting

Basic formatting rules are allowed, including:

* Bold
* Italics
* Code
* Strikethrough
* Hyperlinks
* Ordered lists
* Unordered lists

The following markdown illustrates a few common styles.

<pre>
**Bold**, *italics*, and ~~strikethrough~~ may be used.

Ordered lists:
1. Item 1
1. Item 2
  1. Item 2.1

Unordered lists:
* Item 1
* Item 2
  * Item 2.1
</pre>

Additionally, a subset of inline HTML tags are supported for styling.

* `<span>`
* `<sup>`
* `<sub>`
* `<em>`
* `<i>`
* `<strong>`
* `<b>`

Supported CSS styles for use with `<span>` elements:

* `color`
* `background-color`
* `font-weight: bold`
* `font-style: italic`
* `text-decoration: underline`
* `text-decoration: line-through`
* `font-family`
* `font-variant: small-caps`
* `font-size` (must use points for units)

You may also use `{style="..."}` [attributes](https://www.npmjs.com/package/markdown-it-attrs)
after markdown elements to apply styles. This can be used on headers, inline
elements, code blocks, etc.

### Emoji

Use Github style [emoji](http://www.webpagefx.com/tools/emoji-cheat-sheet/) in your text using
the `:emoji:`.

The following example inserts emoji in the header and body of the slide.

<pre>
### I :heart: cats

:heart_eyes_cat:
</pre>

### Code blocks

Both indented and fenced code blocks are supported, with syntax highlighting.

The following example renders highlighted code.

<pre>
### Hello World

```javascript
console.log('Hello world');
```
</pre>

To change the syntax highlight theme specify the `--style <theme>` option on the
command line. All [highlight.js themes](https://github.com/isagalaev/highlight.js/tree/master/src/styles)
are supported. For example, to use the github theme

```sh
md2gslides slides.md --style github
```

You can also apply additional style changes to the entire block, such as changing
the font size:

<pre>
### Hello World

```javascript
console.log('Hello world');
```{style="font-size: 36pt"}
</pre>

#### Code blocks on template slides

On template slides, fenced code blocks are automatically rendered as **syntax-highlighted PNG images** using [silicon](https://github.com/Aloxaf/silicon) and placed in the slide's `image_area` (defined in the manifest). This produces much better results than inline text for code-heavy slides.

<pre>
{template_slide="Code Block Template"}

# Example

Description text goes here

```python
def hello():
    print("world")
```
</pre>

The code image uses the `OneHalfDark` theme by default. On non-template slides, code blocks continue to render as inline styled text (existing behavior).

**Requires:** `silicon` (`brew install silicon`)

### D2 diagrams

[D2](https://d2lang.com) diagrams can be included as images by referencing a `.d2` file:

<pre>
![](path/to/diagram.d2)
</pre>

The `.d2` file is rendered to PNG at generation time and placed on the slide. On template slides, d2 images are placed in the `image_area`.

Optional attributes control rendering:

<pre>
![](diagram.d2){theme=200 d2-layout=elk d2-scale=2}
</pre>

**Requires:** `d2` (`brew install d2`)

### Tables

Tables are supported via
[GFM](https://guides.github.com/features/mastering-markdown/#GitHub-flavored-markdown) syntax.

Note: Including tables and other block elements on the same slide may produce poor results with
overlapping elements. Either avoid or manually adjust the layout after generating the slides.

The following generates a 2x5 table on the slide.

<pre>
### Top pets in the United States

Animal | Number
-------|--------
Fish   | 142 million
Cats   | 88 million
Dogs   | 75 million
Birds  | 16 million
</pre>

### Local images

Images referencing local paths temporarily uploaded and hosted to [file.io](https://file.io). File.io
is an emphemeral file serving service that generates short-lived random URLs to the upload file and deletes
content shortly after use.

Since local images are uploaded to a thrid party, explicit opt-in is required to use this feature.
Include the `--use-fileio` option to opt-in to uploading images. This applies to file-based images as well
as automatically rasterized content like math expressions and SVGs.

### Image rasterization

Slides can also include generated images, using `$$$` fenced blocks
for the data. Currently supported generated images are math expression (TeX
and MathML) as well as SVG. Rasterized images are treated like local images are require
opt-in to uploading images to a 3rd party service via the `--use-fileio` option.

Using TeX:

<pre>
# How about some math?

$$$ math
\cos (2\theta) = \cos^2 \theta - \sin^2 \theta
$$$
</pre>

SVG

<pre>
# Or some SVG?

$$$ svg
&lt;svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 48 48">
  &lt;defs>
    &lt;path id="a" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
  &lt;/defs>
  &lt;clipPath id="b">
    &lt;use xlink:href="#a" overflow="visible"/>
  &lt;/clipPath><path clip-path="url(#b)" fill="#FBBC05" d="M0 37V11l17 13z"/>
  &lt;path clip-path="url(#b)" fill="#EA4335" d="M0 11l17 13 7-6.1L48 14V0H0z"/>
  &lt;path clip-path="url(#b)" fill="#34A853" d="M0 37l30-23 7.9 1L48 0v48H0z"/>
  &lt;path clip-path="url(#b)" fill="#4285F4" d="M48 48L17 24l-4-3 35-10z"/>
&lt;/svg>
$$$
</pre>

Like local images, generated images are temporarily served via file.io.

Pull requests for other image generators (e.g. mermaid, chartjs, etc.) are welcome!

## Reading from standard input

You can also pipe markdown into the tool by omitting the file name argument.

## Contributing

With the exception of `/bin/md2gslides.js`, TypeScript is used throughout and compiled
with [Babel](https://babeljs.io/). [Mocha](https://mochajs.org/) and [Chai](http://chaijs.com/)
are used for testing.

Before anything, ensure you have all dependencies:

```sh
npm install
```

To compile:

```sh
npm run compile
```

To run unit tests:

```sh
npm run test
```

To lint/format tests:

```sh
npm run lint
```

See [CONTRIBUTING](CONTRIBUTING.md) for additional terms.

## License

This library is licensed under Apache 2.0. Full license text is
available in [LICENSE](LICENSE).
