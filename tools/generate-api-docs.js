#!/usr/bin/env node
/**
 * Generates docs/api-reference.md from docs/openapi.json.
 * Pass --check to fail when the committed Markdown is stale.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'docs', 'openapi.json');
const outputPath = path.join(root, 'docs', 'api-reference.md');

function schemaLabel(schema) {
  if (!schema || typeof schema !== 'object') return '';
  if (schema.$ref) return schema.$ref.replace('#/components/schemas/', '');
  if (schema.type === 'array') {
    const items = schemaLabel(schema.items);
    return items ? `array of ${items}` : 'array';
  }
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(' \\| ');
  return schema.type || 'object';
}

function formatParameters(parameters) {
  if (!parameters || parameters.length === 0) return '';
  const rows = parameters.map((parameter) => {
    const required = parameter.required ? 'yes' : 'no';
    const type = schemaLabel(parameter.schema);
    const description = (parameter.description || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return `| \`${parameter.name}\` | ${parameter.in} | ${type} | ${required} | ${description} |`;
  });
  return ['', '**Parameters**', '', '| Name | In | Type | Required | Description |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
}

function formatResponses(responses) {
  const entries = Object.entries(responses || {});
  if (entries.length === 0) return '';
  const lines = ['', '**Responses**', ''];
  for (const [status, response] of entries) {
    lines.push(`- \`${status}\` — ${response.description || 'No description'}`);
  }
  return lines.join('\n');
}

function render(spec) {
  const info = spec.info || {};
  const lines = [
    `# ${info.title || 'API reference'}`,
    '',
    `Generated from \`docs/openapi.json\`. Do not edit by hand; run \`node tools/generate-api-docs.js\`.`,
    '',
  ];
  if (info.description) lines.push(info.description, '');
  if (info.version) lines.push(`Version: \`${info.version}\``, '');

  const paths = spec.paths || {};
  const byTag = new Map();
  for (const [route, item] of Object.entries(paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
      const operation = item[method];
      if (!operation) continue;
      const tag = (operation.tags && operation.tags[0]) || 'General';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push({ route, method, operation });
    }
  }

  const tags = [...byTag.keys()].sort();
  lines.push('## Contents', '');
  for (const tag of tags) {
    lines.push(`- [${tag}](#${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')})`);
  }
  lines.push('');

  for (const tag of tags) {
    lines.push(`## ${tag}`, '');
    for (const { route, method, operation } of byTag.get(tag)) {
      const summary = operation.summary || `${method.toUpperCase()} ${route}`;
      lines.push(`### ${method.toUpperCase()} \`${route}\``, '', summary, '');
      if (operation.description && operation.description !== summary) {
        lines.push(operation.description, '');
      }
      if (operation.security) {
        lines.push('Authentication required.', '');
      }
      const parameters = formatParameters(operation.parameters);
      if (parameters) lines.push(parameters.trimEnd(), '');
      if (operation.requestBody) {
        const content = operation.requestBody.content || {};
        const media = Object.keys(content)[0];
        const bodyType = media ? schemaLabel(content[media].schema) : 'body';
        lines.push(`**Request body:** \`${bodyType}\`${media ? ` (\`${media}\`)` : ''}`, '');
      }
      const responses = formatResponses(operation.responses);
      if (responses) lines.push(responses.trimEnd(), '');
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function main() {
  const spec = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const markdown = render(spec);
  const check = process.argv.includes('--check');
  if (check) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (current !== markdown) {
      console.error('docs/api-reference.md is out of date. Run: node tools/generate-api-docs.js');
      process.exit(1);
    }
    console.log('docs/api-reference.md is up to date.');
    return;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown);
  console.log(`Wrote ${path.relative(root, outputPath)}`);
}

main();
