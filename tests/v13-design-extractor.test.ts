import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanPlatformTitleSuffix,
  sanitizeSvgMarkup,
  isRgbaBufferBlank,
  computeCropBox,
} from '../utils/dom-helpers';
import {
  detectDesignPlatform,
  restoreHighResDesignUrl,
} from '../core/extractors/design-extractor';

test('detectDesignPlatform accurately identifies all 7+ design platforms', () => {
  assert.equal(detectDesignPlatform('https://www.figma.com/design/abc123/Checkout-UI', false), 'figma');
  assert.equal(detectDesignPlatform('https://app.zeplin.io/project/65a1/screen/99', false), 'zeplin');
  assert.equal(detectDesignPlatform('https://www.sketch.com/s/123456', false), 'sketch');
  assert.equal(detectDesignPlatform('https://team.sketch.cloud/s/abcdef', false), 'sketch');
  assert.equal(detectDesignPlatform('https://lanhuapp.com/web/#/item/project/stage?pid=1', false), 'lanhu');
  assert.equal(detectDesignPlatform('https://app.mockplus.cn/app/12345', false), 'mockplus');
  assert.equal(detectDesignPlatform('https://www.mockplus.com/dt/file/1', false), 'mockplus');
  assert.equal(detectDesignPlatform('https://mastergo.com/file/998877', false), 'mastergo');
  assert.equal(detectDesignPlatform('https://pixso.cn/app/editor/xyz', false), 'pixso');
  assert.equal(detectDesignPlatform('https://pixso.net/app/design/xyz', false), 'pixso');
  assert.equal(detectDesignPlatform('https://modao.cc/app/design/abc', false), 'modao');
  assert.equal(detectDesignPlatform('https://app.axure.cloud/app/project/1', false), 'axure');
  assert.equal(detectDesignPlatform('https://myteam.axshare.com/#id=abc', false), 'axure');
  assert.equal(detectDesignPlatform('https://internal.example.com/wireframe', true), 'axure');
  assert.equal(detectDesignPlatform('https://example.com/gallery', false), 'generic-design');
});

test('cleanPlatformTitleSuffix removes brand suffixes cleanly across platforms', () => {
  assert.equal(cleanPlatformTitleSuffix('Checkout Flow – Figma'), 'Checkout Flow');
  assert.equal(cleanPlatformTitleSuffix('用户中心改版 - 蓝湖'), '用户中心改版');
  assert.equal(cleanPlatformTitleSuffix('Dashboard | Zeplin'), 'Dashboard');
  assert.equal(cleanPlatformTitleSuffix('Mobile Home — Sketch Cloud'), 'Mobile Home');
  assert.equal(cleanPlatformTitleSuffix('订单详情 - 摹客RP - Mockplus'), '订单详情');
  assert.equal(cleanPlatformTitleSuffix('设计系统 · MasterGo'), '设计系统');
  assert.equal(cleanPlatformTitleSuffix('活动页原型 - Pixso'), '活动页原型');
  assert.equal(cleanPlatformTitleSuffix('登录弹窗 - 墨刀'), '登录弹窗');
  assert.equal(cleanPlatformTitleSuffix('报名表单 - Axure Cloud'), '报名表单');
  // Preserve original if stripping would leave empty string
  assert.equal(cleanPlatformTitleSuffix('Figma'), 'Figma');
});

test('restoreHighResDesignUrl strips unsigned CDN resize params and preserves signed URLs', () => {
  assert.equal(
    restoreHighResDesignUrl('https://cdn.lanhuapp.com/img/board1.png?x-oss-process=image/resize,w_400'),
    'https://cdn.lanhuapp.com/img/board1.png'
  );
  assert.equal(
    restoreHighResDesignUrl('https://cdn.example.com/art.png?imageMogr2/thumbnail/600x'),
    'https://cdn.example.com/art.png'
  );
  assert.equal(
    restoreHighResDesignUrl('https://cdn.example.com/art.png?imageView2=1&w=320&q=75'),
    'https://cdn.example.com/art.png'
  );
  assert.equal(
    restoreHighResDesignUrl('https://imgix.zeplin.io/screen.png?w=480&fit=crop&auto=format&dpr=1'),
    'https://imgix.zeplin.io/screen.png'
  );
  assert.equal(
    restoreHighResDesignUrl('https://cdn.lanhuapp.com/art.png!small'),
    'https://cdn.lanhuapp.com/art.png'
  );
  assert.equal(
    restoreHighResDesignUrl('https://cdn.sketch.com/screens/home_thumb.webp'),
    'https://cdn.sketch.com/screens/home.webp'
  );

  // Signed URLs must NEVER have query params mutated
  const signedOss = 'https://bucket.oss-cn.aliyuncs.com/a.png?OSSAccessKeyId=abc&Signature=xyz&x-oss-process=image/resize,w_400';
  assert.equal(restoreHighResDesignUrl(signedOss), signedOss);

  const signedS3 = 'https://s3.amazonaws.com/a.png?X-Amz-Signature=deadbeef&w=400';
  assert.equal(restoreHighResDesignUrl(signedS3), signedS3);
});

test('sanitizeSvgMarkup enforces xmlns + viewBox and strips XSS vectors', () => {
  const dirty = `<svg width="64" height="64" onload="alert(1)" onclick="steal()">
    <script>alert('xss')</script>
    <foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)></body></foreignObject>
    <a xlink:href="javascript:alert(2)" href="javascript:void(0)"><rect width="64" height="64" fill="#4f46e5" onmouseover="bad()" /></a>
    <set attributeName="onbegin" to="alert(3)" />
    <path d="M0 0 L64 64" stroke="#ffffff" style="background: expression(alert(4))" />
  </svg>`;

  const safe = sanitizeSvgMarkup(dirty, '0 0 64 64');
  assert.match(safe, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(safe, /viewBox="0 0 64 64"/);
  assert.doesNotMatch(safe, /<script/i);
  assert.doesNotMatch(safe, /<foreignObject/i);
  assert.doesNotMatch(safe, /\bon(?:load|click|mouseover|error)\s*=/i);
  assert.doesNotMatch(safe, /javascript:/i);
  assert.doesNotMatch(safe, /expression\s*\(/i);
  assert.doesNotMatch(safe, /<set\b/i);
  // Legitimate vector geometry preserved
  assert.match(safe, /<rect[^>]+fill="#4f46e5"/);
  assert.match(safe, /<path[^>]+d="M0 0 L64 64"/);
});

test('isRgbaBufferBlank detects empty, transparent, and uniform solid WebGL frames', () => {
  const w = 64;
  const h = 64;
  // 1. All transparent (alpha === 0)
  const transparent = new Uint8ClampedArray(w * h * 4);
  assert.equal(isRgbaBufferBlank(transparent, w, h), true);

  // 2. Solid black cleared WebGL frame (alpha === 255, RGB === 0,0,0)
  const solidBlack = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    solidBlack[i * 4 + 3] = 255;
  }
  assert.equal(isRgbaBufferBlank(solidBlack, w, h), true);

  // 3. Solid white canvas
  const solidWhite = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.equal(isRgbaBufferBlank(solidWhite, w, h), true);

  // 4. Real content (e.g., white background with indigo artboard region)
  const realFrame = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 16; y < 48; y++) {
    for (let x = 16; x < 48; x++) {
      const idx = (y * w + x) * 4;
      realFrame[idx] = 79;
      realFrame[idx + 1] = 70;
      realFrame[idx + 2] = 229;
      realFrame[idx + 3] = 255;
    }
  }
  assert.equal(isRgbaBufferBlank(realFrame, w, h), false);
});

test('computeCropBox accurately scales by DPR/viewport ratio and clamps bounds', () => {
  // 2x Retina viewport (1440x900 CSS -> 2880x1800 bitmap)
  const box = computeCropBox(2880, 1800, {
    x: 240,
    y: 48,
    width: 960,
    height: 750,
    dpr: 2,
    viewportWidth: 1440,
    viewportHeight: 900,
  });
  assert.deepEqual(box, { sx: 480, sy: 96, sw: 1920, sh: 1500 });

  // Negative & overflowing coordinates safely clamped
  const clamped = computeCropBox(1000, 600, {
    x: -50,
    y: 500,
    width: 1200,
    height: 300,
    dpr: 1,
  });
  assert.deepEqual(clamped, { sx: 0, sy: 500, sw: 1000, sh: 100 });
});
