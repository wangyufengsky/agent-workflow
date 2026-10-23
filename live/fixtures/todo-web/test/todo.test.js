import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addTodo } from '../public/todo.js';

test('addTodo adds trimmed text at the end', () => {
  assert.deepEqual(addTodo(['a'], '  b '), ['a', 'b']);
});

test('addTodo ignores blank text', () => {
  assert.deepEqual(addTodo(['a'], '   '), ['a']);
});
