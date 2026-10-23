import { addTodo } from './todo.js';

let todos = [];
const list = document.getElementById('list');
const input = document.getElementById('text');

function render() {
  list.replaceChildren(
    ...todos.map((todo) => {
      const item = document.createElement('li');
      item.textContent = todo;
      return item;
    }),
  );
}

document.getElementById('add').addEventListener('click', () => {
  todos = addTodo(todos, input.value);
  input.value = '';
  render();
});
