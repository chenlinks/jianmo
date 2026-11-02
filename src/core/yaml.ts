/** Load the browser formatter only when YAML formatting is requested. */
export async function formatYaml(source: string): Promise<string> {
  const [prettier, yaml] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/yaml')
  ]);
  return prettier.format(source, {
    parser: 'yaml', plugins: [yaml], tabWidth: 2, useTabs: false,
    endOfLine: 'lf', embeddedLanguageFormatting: 'off'
  });
}
