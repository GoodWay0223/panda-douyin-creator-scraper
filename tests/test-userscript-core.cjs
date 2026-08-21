const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scriptPath = process.argv[2];
if (!scriptPath) throw new Error('Usage: node test-userscript-core.cjs <userscript>');
const source = fs.readFileSync(scriptPath, 'utf8');

function extractBetween(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0, 'Missing marker: ' + startMarker);
    assert.ok(end > start, 'Missing end marker: ' + endMarker);
    return source.slice(start, end);
}

const coreSource = [
    extractBetween('    function normalizeText(', '\n\n    function escapeHtml('),
    extractBetween('    function escapeHtml(', '\n\n    function escapeRegExp('),
    extractBetween('    function parseNumber(', '\n\n    function hasNumericValue('),
    extractBetween('    function hasNumericValue(', '\n\n    function formatNumber('),
    extractBetween('    function formatNumber(', '\n\n    function hashText(')
].join('\n');

const context = { state: { useWanUnit: false } };
vm.createContext(context);
vm.runInContext(
    coreSource
        + '\nthis.core = { normalizeText, escapeHtml, parseNumber, hasNumericValue, formatNumber, formatSummaryNumber };',
    context
);

const core = context.core;
assert.equal(core.parseNumber('108万'), 1080000);
assert.equal(core.parseNumber('76.3万'), 763000);
assert.equal(core.parseNumber('1.2亿'), 120000000);
assert.equal(core.parseNumber('2.5w'), 25000);
assert.equal(core.parseNumber('3K'), 3000);
assert.equal(core.parseNumber('1,234'), 1234);
assert.equal(core.parseNumber('-'), 0);
assert.equal(core.parseNumber('--'), 0);
assert.equal(core.parseNumber('0'), 0);
assert.equal(core.hasNumericValue('-'), false);
assert.equal(core.hasNumericValue('--'), false);
assert.equal(core.hasNumericValue('0'), true);
assert.equal(core.normalizeText('  播放\n  108万  '), '播放 108万');
assert.equal(
    core.escapeHtml('<img src=x onerror="x">&'),
    '&lt;img src=x onerror=&quot;x&quot;&gt;&amp;'
);
assert.equal(core.formatSummaryNumber(12345678), '12,345,678');
context.state.useWanUnit = true;
assert.equal(core.formatSummaryNumber(12345678), '1234.57万');
assert.equal(core.formatSummaryNumber(987654), '98.77万');
assert.equal(core.formatSummaryNumber(43210), '4.32万');
assert.equal(core.formatSummaryNumber(1), '0.0001万');
assert.equal(core.formatSummaryNumber(0), '0');

assert.match(source, /@version\s+8\.2\.0/);
assert.match(source, /@match\s+https:\/\/creator\.douyin\.com\/\*/);
assert.match(source, /\[class\*="metric-label"\]/);
assert.match(source, /\[class\*="list-scroll"\]/);
assert.match(source, /new MutationObserver/);
assert.match(source, /restoreScroll:\s*readSetting/);
assert.match(source, /class=\"dy-panel\"/);
assert.match(source, /▶ 启动自动抓取/);
assert.match(source, /function showFinalResult/);
assert.match(source, /🎉 抓取完成！/);
assert.match(source, /function formatSummaryNumber/);
assert.match(source, /id=\"btnSettings\"/);
assert.match(source, /id=\"settingsMenu\"/);
assert.match(source, /id=\"useWanUnit\"/);
assert.match(source, /只影响顶部汇总和完成弹窗/);
assert.match(source, /GM_setClipboard/);
assert.match(source, /text\/csv;charset=utf-8/);
assert.match(source, /application\/json;charset=utf-8/);
assert.equal((source.match(/metric-value-k4R5P_/g) || []).length, 1, 'Legacy selector should only appear in diagnostics');
assert.doesNotMatch(source, /document\.onmousemove|document\.onmouseup/);
assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b|document\.cookie/);

const htmlIds = new Set([...source.matchAll(/id=\"([^\"]+)\"/g)].map((match) => match[1]));
const byIdRefs = new Set([...source.matchAll(/byId\('([^']+)'\)/g)].map((match) => match[1]));
const missingIds = [...byIdRefs].filter((id) => !htmlIds.has(id));
assert.deepEqual(missingIds, [], 'Every byId reference must exist in the panel HTML');

console.log('PASS: metadata, syntax-sensitive core helpers, numeric parsing, escaping, permissions, and compatibility guards');
