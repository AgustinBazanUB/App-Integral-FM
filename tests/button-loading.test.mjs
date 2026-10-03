import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { transformSync } from 'esbuild';
const source = readFileSync(new URL('../src/design-system/index.jsx', import.meta.url), 'utf8');
const component = source.slice(source.indexOf('export const Button ='), source.indexOf('export const LoadingButton')).replace('export const', 'const');
const code = transformSync(component, { loader: 'jsx', jsxFactory: 'React.createElement' }).code;
const Button = Function('React', 'forwardRef', 'Icon', `${code}; return Button;`)(React, (render) => ({ render }), () => null);
for (const [loading, disabled, expected] of [[true, false, true], [false, true, true], [false, false, false]]) {
  test(`Button: loading=${loading}, disabled=${disabled} conserva bloqueo=${expected}`, () => {
    const element = Button.render({ children: 'Confirmar', loading, disabled, type: 'submit' }, null);
    assert.equal(element.props.disabled, expected);
    assert.equal(element.props.type, 'submit');
    assert.equal(element.props['aria-busy'], loading || undefined);
  });
}
