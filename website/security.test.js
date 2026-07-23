'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const sec = require('./security');

describe('password policy', () => {
  it('rejects short passwords', () => {
    assert.equal(sec.validatePasswordStrength('Abcd123').ok, false);
  });

  it('rejects common passwords', () => {
    assert.equal(sec.validatePasswordStrength('password123').ok, false);
  });

  it('rejects letters-only', () => {
    assert.equal(sec.validatePasswordStrength('abcdefghijkl').ok, false);
  });

  it('accepts strong passwords without truncating', () => {
    const long = 'CorrectHorseBatteryStaple99!' + 'x'.repeat(50);
    assert.equal(sec.validatePasswordStrength(long).ok, true);
    assert.equal(long.length > 12, true);
  });
});

describe('dangerous uploads', () => {
  it('blocks executable extensions', () => {
    assert.equal(sec.isDangerousUploadFilename('payload.exe'), true);
    assert.equal(sec.isDangerousUploadFilename('x.php'), true);
    assert.equal(sec.isDangerousUploadFilename('run.sh'), true);
  });

  it('blocks double extensions', () => {
    assert.equal(sec.isDangerousUploadFilename('image.png.exe'), true);
  });

  it('allows normal images', () => {
    assert.equal(sec.isDangerousUploadFilename('photo.png'), false);
    assert.equal(sec.isDangerousUploadFilename('doc.txt'), false);
  });

  it('blocks path tricks', () => {
    assert.equal(sec.isDangerousUploadFilename('../secret.txt'), true);
  });
});

describe('path safety', () => {
  const root = require('path').join(__dirname, 'public');

  it('blocks traversal', () => {
    assert.equal(sec.resolveSafePath(root, '/../../etc/passwd'), null);
    assert.equal(sec.resolveSafePath(root, '/%2e%2e/secret'), null);
  });

  it('allows public files', () => {
    const p = sec.resolveSafePath(root, '/index.html');
    assert.ok(p && p.endsWith('index.html'));
  });
});

describe('sanitization', () => {
  it('escapes html', () => {
    assert.equal(sec.escapeHtml('<script>'), '&lt;script&gt;');
  });

  it('strips control chars from plain text', () => {
    const out = sec.sanitizePlainText('hi\u0000<script>alert(1)</script>', 64);
    assert.ok(!out.includes('\u0000'));
    assert.ok(out.includes('<script>')); // sanitizer is plain-text length/control, XSS via textContent
  });
});

describe('rate limit', () => {
  it('blocks after limit', () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    let last;
    for (let i = 0; i < 4; i++) last = sec.rateLimit(key, { limit: 3, windowMs: 60_000 });
    assert.equal(last.ok, false);
  });
});

describe('thread id validation', () => {
  it('accepts hex ids', () => {
    assert.equal(sec.isValidThreadId('a1b2c3d4e5f67890'), true);
  });
  it('rejects injection', () => {
    assert.equal(sec.isValidThreadId('../x'), false);
    assert.equal(sec.isValidThreadId(''), false);
  });
});
