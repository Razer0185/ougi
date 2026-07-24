'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const faq = require('./chat-faq');

describe('chat-faq', () => {
  it('answers where to buy', () => {
    const r = faq.maybeAutoReply('t1', 'where can I buy ougi?');
    assert.ok(r);
    assert.equal(r.intent, 'buy');
    assert.match(r.text, /pay\.html/i);
    assert.match(r.text, /pricing\.html/i);
  });

  it('answers activate', () => {
    const r = faq.maybeAutoReply('t2', 'how do I activate hosting?');
    assert.ok(r);
    assert.equal(r.intent, 'activate');
    assert.match(r.text, /host\.html/i);
  });

  it('answers invite', () => {
    const r = faq.maybeAutoReply('t3', 'how do I invite the bot?');
    assert.ok(r);
    assert.equal(r.intent, 'invite');
    assert.match(r.text, /Host page/i);
  });

  it('cools down same intent', () => {
    const a = faq.maybeAutoReply('t4', 'pricing please');
    const b = faq.maybeAutoReply('t4', 'how much does it cost');
    assert.ok(a);
    assert.equal(b, null);
  });

  it('ignores unrelated text', () => {
    assert.equal(faq.maybeAutoReply('t5', 'hello there'), null);
  });
});
