/** The list with `text` added at the end; blank text adds nothing. */
export function addTodo(todos, text) {
  const trimmed = text.trim();
  return trimmed === '' ? todos : [...todos, trimmed];
}
