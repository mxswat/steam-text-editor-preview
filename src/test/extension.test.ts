import * as assert from 'assert';

suite('BBCode Parser Tests', () => {
  test('bold tag', () => {
    const { parseBBCode } = require('../bbcodeParser');
    const result = parseBBCode('[b]hello[/b]');
    assert.ok(result.includes('<strong>hello</strong>'));
  });

  test('italic tag', () => {
    const { parseBBCode } = require('../bbcodeParser');
    const result = parseBBCode('[i]italic[/i]');
    assert.ok(result.includes('<em>italic</em>'));
  });

  test('url with value', () => {
    const { parseBBCode } = require('../bbcodeParser');
    const result = parseBBCode('[url=https://example.com]click[/url]');
    assert.ok(result.includes('href="https://example.com"'));
    assert.ok(result.includes('click'));
  });

  test('noparse escapes tags', () => {
    const { parseBBCode } = require('../bbcodeParser');
    const result = parseBBCode('[noparse][b]not bold[/b][/noparse]');
    assert.ok(result.includes('&lt;strong&gt;not bold&lt;/strong&gt;'));
  });

  test('list tag', () => {
    const { parseBBCode } = require('../bbcodeParser');
    const result = parseBBCode('[list][*]item1[*]item2[/list]');
    assert.ok(result.includes('<ul>'));
    assert.ok(result.includes('<li>item1</li>'));
    assert.ok(result.includes('<li>item2</li>'));
    assert.ok(result.includes('</ul>'));
  });
});
