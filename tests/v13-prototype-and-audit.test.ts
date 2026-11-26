import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPrototypePrdPlatform,
  isPrototypeChromeNoise,
  sortBlocksByVisualOrder,
  formatPrototypePrdMarkdown,
} from '../core/extractors/prototype-prd-extractor';
import {
  dereferenceSchema,
  flattenSchemaToRows,
  synthesizeExampleFromSchema,
  convertOpenApiJsonToMarkdown,
} from '../core/extractors/api-extractor';
import { renderTencentInlineLine, type TencentCharFormat } from '../core/extractors/tencent-doc-extractor';
import { computeMarkdownSpecDiff } from '../utils/spec-diff';
import { autoTrimNoisySections } from '../utils/markdown-trimmer';
import { validateSpecsRootDir } from '../utils/filesystem-writer';
import { createSpecBundleManifest } from '../utils/specloop-bridge';
import { messages } from '../utils/i18n';

test('detectPrototypePrdPlatform recognizes Axure Cloud, axshare, Modao, Pixso, Mockplus RP', () => {
  assert.equal(detectPrototypePrdPlatform('https://app.axure.cloud/app/project/abc', false), 'axure-cloud');
  assert.equal(detectPrototypePrdPlatform('https://team123.axshare.com/#id=home', false), 'axure-cloud');
  assert.equal(detectPrototypePrdPlatform('https://modao.cc/app/123456', false), 'modao');
  assert.equal(detectPrototypePrdPlatform('https://mockingbot.com/app/xyz', false), 'modao');
  assert.equal(detectPrototypePrdPlatform('https://pixso.cn/app/proto/abc', false), 'pixso');
  assert.equal(detectPrototypePrdPlatform('https://rp.mockplus.cn/run/abc', false), 'mockplus-rp');
  assert.equal(detectPrototypePrdPlatform('https://app.mockplus.cn/rp/project/1', false), 'mockplus-rp');
  assert.equal(detectPrototypePrdPlatform('https://intranet.example.com/proto/index.html', true), 'axure-local');
  assert.equal(detectPrototypePrdPlatform('https://pixso.cn/article/some-blog', false), null);
  assert.equal(detectPrototypePrdPlatform('https://confluence.example.com/pages/123', false), null);
});

test('isPrototypeChromeNoise filters toolbar buttons while preserving PRD notes', () => {
  assert.equal(isPrototypeChromeNoise('登录'), true);
  assert.equal(isPrototypeChromeNoise('Fullscreen'), true);
  assert.equal(isPrototypeChromeNoise('100%'), true);
  assert.equal(isPrototypeChromeNoise('未登录用户点击立即报名时弹出 OTP 登录弹窗'), false);
});

test('sortBlocksByVisualOrder orders top-to-bottom and left-to-right within row tolerance', () => {
  const sorted = sortBlocksByVisualOrder([
    { top: 200, left: 40, text: 'Row 2' },
    { top: 58, left: 300, text: 'Row 1 Right' },
    { top: 50, left: 40, text: 'Row 1 Left' },
  ]);
  assert.deepEqual(
    sorted.map((b) => b.text),
    ['Row 1 Left', 'Row 1 Right', 'Row 2']
  );
});

test('formatPrototypePrdMarkdown produces dual-track frontmatter, snapshot, notes & widget annotations', () => {
  const md = formatPrototypePrdMarkdown({
    title: '活动报名页原型',
    sourceUrl: 'https://app.axure.cloud/app/project/demo',
    platform: 'axure-cloud',
    breadcrumb: '活动中心 / 报名表单',
    snapshotPath: './assets/活动报名页原型/prototype-001.png',
    pageNotes: ['未登录用户点击立即报名时拦截并弹出无密码登录弹窗。'],
    widgetAnnotations: [{ label: '手机号输入框', note: '实时校验 11 位格式，失焦提示报错。' }],
    assetCount: 1,
  });

  assert.match(md, /type: "prd-prototype"/);
  assert.match(md, /platform: "axure-cloud"/);
  assert.match(md, /asset_count: 1/);
  assert.match(md, /活动中心 \/ 报名表单/);
  assert.match(md, /!\[活动报名页原型\]\(\.\/assets\/活动报名页原型\/prototype-001\.png\)/);
  assert.match(md, /无密码登录弹窗/);
  assert.match(md, /1\. \*\*手机号输入框\*\*：实时校验 11 位格式/);
});

test('renderTencentInlineLine preserves bold formatting outside and inside HYPERLINK field codes', () => {
  const text = '请查看 \x13HYPERLINK https://example.com/spec normalLink\x14需求文档\x15 详情';
  const map: Record<number, TencentCharFormat> = {};
  // Bold "请查看" (0..2) and "需求文档" (inside \x14..\x15)
  map[0] = { bold: true };
  map[1] = { bold: true };
  map[2] = { bold: true };
  const displayStart = text.indexOf('需求文档');
  for (let i = 0; i < 4; i++) {
    map[displayStart + i] = { bold: true };
  }

  const rendered = renderTencentInlineLine(text, 0, map);
  assert.equal(rendered, '**请查看** [**需求文档**](https://example.com/spec) 详情');
});

test('OpenAPI engine dereferences circular $ref, allOf, oneOf/anyOf, Swagger 2.0 body, and selective subset', () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Order API', version: '2.0.0' },
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 42 },
            parent: { $ref: '#/components/schemas/Node' },
            nickname: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Optional alias' },
            payload: {
              oneOf: [
                { title: 'TextPayload', type: 'object', properties: { text: { type: 'string' } } },
                { title: 'ImagePayload', type: 'object', properties: { url: { type: 'string' } } },
              ],
            },
            meta: {
              // Intentional omitted `type: 'object'` to test nested recursion fix
              properties: {
                tag: { type: 'string' },
              },
            },
          },
          required: ['id'],
        },
      },
    },
    paths: {
      '/orders': {
        parameters: [{ name: 'X-Trace-Id', in: 'header', schema: { type: 'string' } }],
        post: {
          summary: 'Create Order',
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Node' },
              },
            },
          },
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
            },
          },
        },
      },
      '/health': {
        get: { summary: 'Health check', responses: { '200': { description: 'OK' } } },
      },
    },
  };

  const deref = dereferenceSchema({ $ref: '#/components/schemas/Node' }, spec);
  assert.equal(deref.properties.parent.description, '[Circular: Node]');
  assert.equal(deref.properties.nickname.nullable, true);

  const rows = flattenSchemaToRows({ $ref: '#/components/schemas/Node' }, spec);
  assert.ok(rows.some((r) => r.path === 'meta.tag'));
  assert.ok(rows.some((r) => r.path === 'nickname' && r.type.includes('null')));
  assert.ok(rows.some((r) => r.path === 'payload' && r.type.startsWith('oneOf<')));

  const example = synthesizeExampleFromSchema({ $ref: '#/components/schemas/Node' }, spec);
  assert.equal(example.id, 42);

  const { markdown, endpointsCount } = convertOpenApiJsonToMarkdown(spec, 'https://api.example.com/docs', [
    'POST /orders',
  ]);
  assert.equal(endpointsCount, 1);
  assert.match(markdown, /X-Trace-Id/);
  assert.match(markdown, /`meta\.tag`/);
  assert.doesNotMatch(markdown, /\/health/);
});

test('spec-diff, markdown-trimmer, specs-root validation & SpecBundle manifest v1.3 metadata', () => {
  const oldMd = '---\nextracted_at: "2026-11-20"\n---\n\n# Spec\n\n## Feature A\nOld rule\n\n## 修订历史\n- v1\n';
  const newMd = '---\nextracted_at: "2026-11-25"\n---\n\n# Spec\n\n## Feature A\nNew rule\n\n## Feature B\nAdded\n';
  const diff = computeMarkdownSpecDiff(oldMd, newMd, 'Spec', 'Spec.md');
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.addedSections, 1);
  assert.equal(diff.modifiedSections, 1);
  assert.equal(diff.removedSections, 1);

  const trimmed = autoTrimNoisySections(oldMd);
  assert.deepEqual(trimmed.removedHeadings, ['修订历史']);
  assert.doesNotMatch(trimmed.markdown, /修订历史/);

  assert.equal(validateSpecsRootDir('docs/specs').valid, true);
  assert.equal(validateSpecsRootDir('../outside').errorCode, 'traversal');
  assert.equal(validateSpecsRootDir('/abs/path').errorCode, 'absolute');

  const manifest = createSpecBundleManifest({
    type: 'design',
    title: 'Checkout UI',
    sanitizedTitle: 'Checkout_UI',
    sourceUrl: 'https://www.figma.com/design/xyz/Checkout',
    markdownFile: 'Checkout_UI.md',
    assetsCount: 3,
    artboardsCount: 3,
    vectorCount: 1,
    platform: 'figma',
  });
  assert.equal(manifest.designUrl, 'https://www.figma.com/design/xyz/Checkout');
  assert.equal(manifest.sourceType, 'design-spec');
  assert.equal(manifest.platform, 'figma');
  assert.equal(manifest.vectorCount, 1);
});

test('i18n en and zh-CN dictionaries maintain 100% key and value-type parity', () => {
  const enKeys = Object.keys(messages.en).sort();
  const zhKeys = Object.keys(messages['zh-CN']).sort();
  assert.deepEqual(zhKeys, enKeys);

  for (const key of enKeys) {
    const enVal = (messages.en as Record<string, unknown>)[key];
    const zhVal = (messages['zh-CN'] as Record<string, unknown>)[key];
    assert.equal(typeof zhVal, typeof enVal, `Type mismatch for i18n key "${key}"`);
  }
});
