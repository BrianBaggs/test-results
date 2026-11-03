import { XMLParser, XMLBuilder } from 'fast-xml-parser';

// Attributes get a real prefix here, unlike src/utils/xmlParser.ts (which uses
// '' so attributes and child elements share one flat object). That flat shape is
// fine for reading but can't be written back: with no prefix the builder can't
// tell a text-only child element from an attribute, so <skipped/>, <system-out>
// and <properties/> were emitted as attributes on <testcase> — silently turning
// every skipped test into a passed one and moving each failure's attachments
// out of <system-out>. The prefix keeps the two apart through the round trip.
// parseTagValue is off so element text (e.g. <system-out>) stays an exact string
// instead of being coerced to a number/boolean. CDATA sections (how Playwright wraps
// failure stack traces and attachment output) are kept as CDATA: the app's parser
// trims plain text but not CDATA, so flattening one to text would silently strip the
// trace's leading indentation and trailing newline when the merged file is loaded.
const ATTR = '@_';
const CDATA = '__cdata';
const PARSER_OPTIONS = { ignoreAttributes: false, attributeNamePrefix: ATTR, parseTagValue: false, cdataPropName: CDATA };
// Fallback for the one shape CDATA-preserving can't round-trip: an element mixing plain
// text with a CDATA section loses the order of the two. No JUnit reporter writes that, but
// a file containing it is parsed with CDATA folded into text (correct order, only the
// edge whitespace the app trims anyway is lost) rather than silently reordered.
const FLAT_PARSER_OPTIONS = { ...PARSER_OPTIONS, cdataPropName: false as const };

function hasMixedCdata(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasMixedCdata);
  if (node === null || typeof node !== 'object') return false;
  const obj = node as XmlNode;
  if (obj[CDATA] !== undefined && obj['#text'] !== undefined) return true;
  return Object.values(obj).some(hasMixedCdata);
}

type XmlNode = Record<string, unknown>;

function toArray(value: unknown): XmlNode[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? (value as XmlNode[]) : [value as XmlNode];
}

const attrOf = (node: XmlNode, field: string): unknown => node[`${ATTR}${field}`];

function numberOf(value: unknown): number {
  const n = parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

export interface JUnitXmlFile {
  name: string;
  xml: string;
}

export interface MergeResult {
  xml: string;
  fileCount: number;
  suiteCount: number;
  warnings: string[];
}

/**
 * Combines independent JUnit XML reports — one per Playwright shard — into a
 * single JUnit XML document. Unlike combineResults.ts (which deliberately
 * de-duplicates the passed/skipped tests two *split* halves share by design),
 * a sharded run divides the suite across shards up front, so each shard's
 * <testsuite> blocks are expected to be disjoint: every testsuite from every
 * file is kept as-is and concatenated under one <testsuites> root, with
 * root-level totals recomputed as a sum across all of them rather than
 * trusted from any one file. Run time is summed from each file's own root
 * `time` (falling back to its suites' times when it has none), so the result
 * equals the shards' reported times added together.
 *
 * The one exception is a suite that reappears, byte-for-byte identical,
 * across more than one file (the same shard re-uploaded, or two shards that
 * genuinely overlap): that's never counted twice. Elsewhere in this app, a
 * failing test is counted once per raw <testsuite> occurrence (Dashboard,
 * Failures) but once per unique test *identity* (Progress, which stores
 * entries in an object keyed by suite+classname+name), so silently keeping
 * an exact duplicate suite in both copies would make those screens disagree
 * about the same data — the Dashboard would show one count, Progress a
 * smaller "deduplicated" one, with nothing to explain why. A same-named
 * suite whose content actually *differs* between files is not auto-resolved
 * — there's no safe way to pick a winner — so every differing copy is kept,
 * and a warning flags the discrepancy instead of hiding it.
 */
export function mergeJUnitXml(files: JUnitXmlFile[]): MergeResult {
  if (files.length === 0) throw new Error('No files to combine.');

  const parser = new XMLParser(PARSER_OPTIONS);
  const flatParser = new XMLParser(FLAT_PARSER_OPTIONS);
  const warnings: string[] = [];
  let rootAttrs: XmlNode = {};
  let haveRootAttrs = false;
  // Every suite collected in file order, tagged with which file (by index,
  // not name — two uploads can share a filename) it came from.
  const collected: Array<{ suite: XmlNode; fileIndex: number }> = [];
  // Each file's own root-level run time, when it has a <testsuites time="…"> wrapper.
  // Playwright's root time is larger than the sum of its suites' times (it includes
  // retry attempts), so it — not the suite sum — is what a single unsharded run's
  // root would have reported, and what summing the shards must reproduce.
  const rootTimes: Array<number | undefined> = [];

  files.forEach((file, fileIndex) => {
    let parsed = parser.parse(file.xml) as { testsuites?: XmlNode; testsuite?: unknown };
    if (hasMixedCdata(parsed)) parsed = flatParser.parse(file.xml) as typeof parsed;
    let suites: XmlNode[];
    if (parsed.testsuites) {
      const { testsuite, ...attrs } = parsed.testsuites;
      rootTimes[fileIndex] = attrs[`${ATTR}time`] !== undefined ? numberOf(attrs[`${ATTR}time`]) : undefined;
      if (!haveRootAttrs) {
        rootAttrs = attrs;
        haveRootAttrs = true;
      }
      suites = toArray(testsuite);
    } else if (parsed.testsuite) {
      rootTimes[fileIndex] = undefined;
      suites = toArray(parsed.testsuite);
    } else {
      throw new Error(`"${file.name}": Invalid JUnit XML format`);
    }

    suites.forEach((suite) => collected.push({ suite, fileIndex }));
  });

  // Identical whole-file uploads are the most common accidental-overlap
  // mistake — flagged by file position (not name) before the per-suite pass
  // below, which uses this set to avoid also warning about the very same
  // duplication one suite at a time.
  const identicalFilePairs = new Set<string>();
  // The later file of each identical pair: its whole contribution (root time included)
  // is a duplicate, not just its suites.
  const duplicateFiles = new Set<number>();
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      if (files[i].xml.trim() === files[j].xml.trim()) {
        identicalFilePairs.add(`${i}|${j}`);
        duplicateFiles.add(j);
        warnings.push(
          `"${files[i].name}" and "${files[j].name}" are byte-for-byte identical — the duplicate's suites were counted once, not twice.`
        );
      }
    }
  }

  const byName = new Map<string, Array<{ suite: XmlNode; fileIndex: number; position: number }>>();
  collected.forEach(({ suite, fileIndex }, position) => {
    const name = attrOf(suite, 'name') !== undefined ? String(attrOf(suite, 'name')) : '';
    if (name === '') return;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push({ suite, fileIndex, position });
  });

  const dropPositions = new Set<number>();
  byName.forEach((entries, name) => {
    const fileIndices = [...new Set(entries.map((e) => e.fileIndex))];
    // Same name repeated within a single file (e.g. the same spec re-run
    // under two browser projects) is ordinary and expected — not cross-file
    // overlap, so every occurrence is left alone.
    if (fileIndices.length <= 1) return;

    const distinctContent = new Set(entries.map((e) => JSON.stringify(e.suite)));
    if (distinctContent.size === 1) {
      entries.slice(1).forEach((e) => dropPositions.add(e.position));
      const explainedByWholeFileWarning =
        fileIndices.length === 2 && identicalFilePairs.has(`${Math.min(...fileIndices)}|${Math.max(...fileIndices)}`);
      if (!explainedByWholeFileWarning) {
        const fileNames = fileIndices.map((i) => files[i].name);
        const uniqueNames = [...new Set(fileNames)];
        const location =
          uniqueNames.length === 1
            ? `uploaded ${fileNames.length} times as "${uniqueNames[0]}"`
            : `in more than one file (${uniqueNames.join(', ')})`;
        warnings.push(`Suite "${name}" was identical, ${location} — counted once, not ${entries.length} times.`);
      }
    } else {
      const fileNames = [...new Set(fileIndices.map((i) => files[i].name))];
      warnings.push(
        `Suite "${name}" appears in more than one file (${fileNames.join(', ')}) with different contents — kept every copy, so the totals below may double-count it. Check these shards don't overlap.`
      );
    }
  });

  const allSuites = collected.filter((_, position) => !dropPositions.has(position)).map((e) => e.suite);

  // Run time: each file contributes its root time (or, with no root, its suites' times),
  // minus any suite dropped as an exact duplicate so it isn't counted a second time. A
  // wholly identical file contributes nothing.
  const timeOfSuite = (suite: XmlNode) => numberOf(attrOf(suite, 'time'));
  let totalTime = 0;
  files.forEach((_, fileIndex) => {
    if (duplicateFiles.has(fileIndex)) return;
    const fileSuites = collected.map((c, position) => ({ ...c, position })).filter((c) => c.fileIndex === fileIndex);
    const suiteSum = fileSuites.reduce((total, c) => total + timeOfSuite(c.suite), 0);
    const droppedSum = fileSuites.filter((c) => dropPositions.has(c.position)).reduce((total, c) => total + timeOfSuite(c.suite), 0);
    totalTime += Math.max(0, (rootTimes[fileIndex] ?? suiteSum) - droppedSum);
  });

  const omit = new Set(['testsuite', ...['tests', 'failures', 'errors', 'skipped', 'time'].map((k) => `${ATTR}${k}`)]);
  const baseAttrs = Object.fromEntries(Object.entries(rootAttrs).filter(([k]) => !omit.has(k)));
  const sumAttr = (field: string) => allSuites.reduce((total, s) => total + numberOf(attrOf(s, field)), 0);

  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: ATTR, cdataPropName: CDATA, format: true });
  // The parser drops the source files' <?xml?> declaration, so write one back.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({
    testsuites: {
      ...baseAttrs,
      [`${ATTR}tests`]: String(sumAttr('tests')),
      [`${ATTR}failures`]: String(sumAttr('failures')),
      [`${ATTR}errors`]: String(sumAttr('errors')),
      [`${ATTR}skipped`]: String(sumAttr('skipped')),
      [`${ATTR}time`]: totalTime.toFixed(3),
      ...(allSuites.length > 0 ? { testsuite: allSuites.length === 1 ? allSuites[0] : allSuites } : {}),
    },
  })}`;

  return {
    xml,
    fileCount: files.length,
    suiteCount: allSuites.length,
    warnings,
  };
}
