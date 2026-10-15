import { useState } from 'react';
import type { NotebookDirectory, NotebookEntry } from '../platform/notebooks.ts';
export function useNotebookLocation() {
  const [trail, setTrail] = useState<NotebookDirectory[]>([]);
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [error, setError] = useState('');
  return { trail, setTrail, entries, setEntries, error, setError };
}
