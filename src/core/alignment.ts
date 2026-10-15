export type BlockAlignment = 'left' | 'center' | 'right';
export type TableStyle = 'simple' | 'grid' | 'striped';
export function tableStyle(value: string | null | undefined): TableStyle | undefined {
  return value === 'simple' || value === 'grid' || value === 'striped' ? value : undefined;
}
export function blockAlignment(value: string | null | undefined): BlockAlignment | undefined {
  return value === 'left' || value === 'center' || value === 'right' ? value : undefined;
}
