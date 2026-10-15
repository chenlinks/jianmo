export type TableAction = 'rowAbove' | 'rowBelow' | 'columnLeft' | 'columnRight' | 'deleteRow' | 'deleteColumn';
export function changeTable(cell: HTMLTableCellElement, action: TableAction): HTMLTableCellElement | null {
  const table = cell.closest('table'); const row = cell.parentElement as HTMLTableRowElement | null;
  if (!table || !row) return null;
  const rows = Array.from(table.rows); const rowIndex = rows.indexOf(row); const columnIndex = cell.cellIndex;
  const width = Math.max(...rows.map(r => r.cells.length));
  // Keep Markdown tables rectangular, including incomplete imported HTML tables.
  for (const r of rows) while (r.cells.length < width) r.insertCell().append(document.createElement('br'));
  let targetRow = rowIndex; let targetColumn = columnIndex;
  if (action === 'rowAbove' || action === 'rowBelow') {
    targetRow = rowIndex + (action === 'rowBelow' ? 1 : 0);
    const added = document.createElement('tr');
    for (let i = 0; i < width; i++) { const c = added.insertCell(); c.append(document.createElement('br')); }
    rows.splice(targetRow, 0, added);
  } else if (action === 'columnLeft' || action === 'columnRight') {
    targetColumn = columnIndex + (action === 'columnRight' ? 1 : 0);
    for (const r of rows) r.insertCell(targetColumn).append(document.createElement('br'));
  } else if (action === 'deleteRow') {
    rows.splice(rowIndex, 1); row.remove(); targetRow = Math.min(rowIndex, rows.length - 1);
  } else {
    for (const r of rows) r.deleteCell(columnIndex);
    targetColumn = Math.min(columnIndex, width - 2);
  }
  if (!rows.length || !rows[0].cells.length) { table.remove(); return null; }
  const head = document.createElement('thead'); const body = document.createElement('tbody');
  rows.forEach((r, i) => {
    for (const c of Array.from(r.cells)) {
      const tag = i === 0 ? 'TH' : 'TD';
      if (c.tagName !== tag) {
        const next = document.createElement(tag.toLowerCase());
        const align = c.getAttribute('align'); if (align) next.setAttribute('align', align);
        next.append(...Array.from(c.childNodes)); c.replaceWith(next);
      }
    }
    (i === 0 ? head : body).append(r);
  });
  table.replaceChildren(head, body);
  return table.rows[targetRow]?.cells[targetColumn] ?? table.rows[0].cells[0];
}
