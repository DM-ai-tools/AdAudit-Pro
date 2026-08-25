declare module 'word-extractor' {
  export default class WordExtractor {
    extract(input: Buffer | string): Promise<{
      getBody(): string;
      getHeaders(): string;
      getFooters(): string;
      getAnnotations(): string;
      getTextboxes(): string;
      getEndnotes(): string;
      getFootnotes(): string;
    }>;
  }
}
