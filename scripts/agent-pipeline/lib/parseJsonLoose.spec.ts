import { describe, expect, it } from 'vitest';
import { parseJsonLoose } from './parseJsonLoose.ts';

describe('parseJsonLoose', () => {
	it('parses plain JSON', () => {
		expect(parseJsonLoose('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
	});

	it('strips a ```json fence wrapping the object', () => {
		expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
	});

	it('strips preamble text before a ```json fence', () => {
		// Live observation (2026-09-04): a real agent reply opened with
		// "Now producing the revised plan JSON." before the fence — the old
		// (anchored-to-start) fence stripping missed this and only recovered
		// via a wasted retry. Should parse on the first attempt now.
		const text = 'Now producing the revised plan JSON.\n\n```json\n{"a":1}\n```';
		expect(parseJsonLoose(text)).toEqual({ ok: true, value: { a: 1 } });
	});

	it('returns ok:false with a message for unparseable text', () => {
		const result = parseJsonLoose('not json at all');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('invalid JSON');
	});
});
