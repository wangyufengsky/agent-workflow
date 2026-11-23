import { expect, it } from 'vitest';
import { hasJavaMain } from './previews.java-source.ts';

it.each([
  ['class Probe { public static void main(String[] args) {} }', 'Probe', true],
  [
    'package 示例; class 服务 { static public void main(java.lang.String... 参数) throws Exception {} }',
    '示例.服务',
    true,
  ],
  ['class Probe { public static void main(final String[] args) {} }', 'Probe', true],
  ['class Other {} class Probe { public static void main(String args[]) {} }', 'Probe', false],
])('recognizes the selected Java main in %s', (source, main, direct) => {
  expect(hasJavaMain(source, main, direct)).toBe(true);
});

it.each([
  ['class Other {} class Probe { public static void main(String[] args) {} }', 'Probe', true],
  ['class Probe { /* public static void main(String[] args) {} */ }', 'Probe', false],
  ['class Probe { String s = "public static void main(String[] args) {}"; }', 'Probe', false],
  ['class Probe {} class Other { public static void main(String[] args) {} }', 'Probe', false],
  ['class Probe { class Inner { public static void main(String[] args) {} } }', 'Probe', false],
  ['class Probe { private static void main(String[] args) {} }', 'Probe', false],
  ['class Probe { public void main(String[] args) {} }', 'Probe', false],
  ['class Probe { public static void main(Object[] args) {} }', 'Probe', false],
  ['package example; class Probe { public static void main(String[] args) {} }', 'Probe', false],
])('rejects a mismatched Java entry in %s', (source, main, direct) => {
  expect(hasJavaMain(source, main, direct)).toBe(false);
});
