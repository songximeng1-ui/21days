import { createHash } from "node:crypto";

export type JdRouteInput = {
  targetJobTitle: string;
  jdTextOrRequirements: string;
  userMaterial: string;
  currentQuestion?: string;
};

export type ExactSourceRef = {
  sourceId: string;
  contentHash: string;
  version: 1;
  fieldPath: "jdTextOrRequirements" | "userMaterial";
  exactQuote: string;
  span: { start: number; end: number };
};

export type JdEvidenceCatalog = {
  requirements: ExactSourceRef[];
  materials: ExactSourceRef[];
};

export function buildJdEvidenceCatalog(input: JdRouteInput): JdEvidenceCatalog {
  return {
    requirements: buildExactSources(input.jdTextOrRequirements, "jdTextOrRequirements", true, 5),
    materials: buildExactSources(input.userMaterial, "userMaterial", false, 20),
  };
}

export function verifyExactSourceRef(input: JdRouteInput, source: ExactSourceRef): boolean {
  const value = input[source.fieldPath];
  if (sha256(value) !== source.contentHash) return false;
  if (source.version !== 1 || source.span.start < 0 || source.span.end <= source.span.start) return false;
  if (value.slice(source.span.start, source.span.end) !== source.exactQuote) return false;
  return source.sourceId === makeSourceId(source.fieldPath, source.contentHash, source.span);
}

function buildExactSources(
  value: string,
  fieldPath: ExactSourceRef["fieldPath"],
  splitSemicolons: boolean,
  limit: number,
): ExactSourceRef[] {
  const contentHash = sha256(value);
  const separator = splitSemicolons ? /\r?\n+|[；;]/g : /\r?\n+/g;
  const rawSegments: Array<{ raw: string; start: number }> = [];
  let cursor = 0;
  for (const match of value.matchAll(separator)) {
    const index = match.index ?? cursor;
    rawSegments.push({ raw: value.slice(cursor, index), start: cursor });
    cursor = index + match[0].length;
  }
  rawSegments.push({ raw: value.slice(cursor), start: cursor });

  const seen = new Set<string>();
  const sources: ExactSourceRef[] = [];
  for (const segment of rawSegments) {
    const normalized = normalizeSegment(segment.raw);
    if (!normalized || seen.has(normalized.quote)) continue;
    seen.add(normalized.quote);
    const span = {
      start: segment.start + normalized.offset,
      end: segment.start + normalized.offset + normalized.quote.length,
    };
    sources.push({
      sourceId: makeSourceId(fieldPath, contentHash, span),
      contentHash,
      version: 1,
      fieldPath,
      exactQuote: normalized.quote,
      span,
    });
    if (sources.length >= limit) break;
  }
  return sources;
}

function normalizeSegment(raw: string): { quote: string; offset: number } | null {
  const leading = raw.match(/^\s*(?:[-*•]|\d+[.)、])?\s*/)?.[0].length ?? 0;
  const withoutPrefix = raw.slice(leading);
  const quote = withoutPrefix.trimEnd();
  return quote ? { quote, offset: leading } : null;
}

function makeSourceId(
  fieldPath: ExactSourceRef["fieldPath"],
  contentHash: string,
  span: ExactSourceRef["span"],
): string {
  const signature = sha256(`${fieldPath}:${contentHash}:${span.start}:${span.end}`).slice(0, 16);
  return `src_${signature}_${span.start}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
