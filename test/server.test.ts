/**
 * Protocol test: starts the real server as a child process over stdio and talks to it
 * with the official MCP client. If anything other than JSON-RPC reached stdout, the
 * client could not parse the stream and these tests would fail.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const SERVER = fileURLToPath(new URL('../src/server.ts', import.meta.url));
let client: Client;

before(async () => {
  client = new Client({ name: 'protocol-test', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      // Defaults only: fictional data in data/ and examples/.
      env: { PATH: process.env.PATH ?? '' },
      stderr: 'ignore',
    }),
  );
});

after(async () => {
  await client.close();
});

test('lists the tools as read-only with output schemas', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'check_alignment',
    'check_terms',
    'list_learning_objectives',
    'lookup_term',
  ]);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations?.openWorldHint, false, tool.name);
    assert.ok(tool.outputSchema, `${tool.name} declares an output schema`);
  }
});

test('check_alignment by path returns evidence as structuredContent', async () => {
  const result = await client.callTool({
    name: 'check_alignment',
    arguments: {
      course_id: 'ADB',
      document: { path: 'adb-facilitation-plan-de.md' },
      document_type: 'facilitation_plan',
      language: 'de',
    },
  });
  assert.equal(result.isError, undefined);
  const data = result.structuredContent as { summary: { partial: number; missing: number } };
  assert.equal(data.summary.partial, 1);
  assert.equal(data.summary.missing, 1);
});

test('a domain error is a tool result with isError, code and hint', async () => {
  const result = await client.callTool({
    name: 'check_alignment',
    arguments: {
      course_id: 'NOPE',
      document: { text: 'x' },
      document_type: 'facilitation_plan',
      language: 'de',
    },
  });
  assert.equal(result.isError, true);
  const first = (result.content as Array<{ type: string; text?: string }>)[0];
  assert.match(first?.text ?? '', /^unknown_course: .*\nHint: Available course ids: ADB/s);
});

test('invalid arguments are a tool result with isError (since 2025-11-25)', async () => {
  const result = await client.callTool({
    name: 'check_alignment',
    arguments: { course_id: 'ADB', document: { text: 'x' }, document_type: 'poem', language: 'de' },
  });
  assert.equal(result.isError, true);
});

test('an unknown tool is a JSON-RPC error', async () => {
  await assert.rejects(client.callTool({ name: 'translate', arguments: {} }), /translate/);
});

test('serves the course template and the rubric', async () => {
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((r) => r.uri).sort(), [
    'course://ADB/learning-objectives',
    'rubric://bloom',
    'termbase://en-de',
  ]);
  const course = await client.readResource({ uri: 'course://ADB/learning-objectives' });
  const first = course.contents[0];
  assert.ok(first && 'text' in first);
  assert.equal(JSON.parse(first.text).objectives.length, 6);
  const rubric = await client.readResource({ uri: 'rubric://bloom' });
  const md = rubric.contents[0];
  assert.ok(md && 'text' in md && md.text.includes('## Verdicts'));
});

test('an unknown course resource is a JSON-RPC error', async () => {
  await assert.rejects(
    client.readResource({ uri: 'course://NOPE/learning-objectives' }),
    /not found/i,
  );
});

test('serves the term base with its licence', async () => {
  const result = await client.readResource({ uri: 'termbase://en-de' });
  const first = result.contents[0];
  assert.ok(first && 'text' in first);
  const data = JSON.parse(first.text) as { license: string; terms: unknown[]; file?: string };
  assert.equal(data.license, 'CC BY-SA 4.0');
  assert.ok(data.terms.length >= 30);
  assert.equal(data.file, undefined, 'no local path in the resource');
});

test('check_terms and lookup_term over the protocol', async () => {
  const terms = await client.callTool({
    name: 'check_terms',
    arguments: { document: { path: 'adb-facilitation-plan-de.md' }, language: 'de-CH' },
  });
  const data = terms.structuredContent as { summary: { findings: number; locale: number } };
  assert.equal(data.summary.findings, 3);
  assert.equal(data.summary.locale, 1);
  const lookup = await client.callTool({ name: 'lookup_term', arguments: { term: 'Retro' } });
  assert.equal(lookup.isError, undefined);
  assert.equal((lookup.structuredContent as { found: boolean }).found, false);
});

test('offers the prompt template with completion for the course id', async () => {
  const { prompts } = await client.listPrompts();
  assert.deepEqual(
    prompts.map((p) => p.name),
    ['validate_course_material'],
  );
  assert.deepEqual(
    prompts[0]?.arguments?.map((a) => a.name),
    ['course_id', 'document', 'document_type', 'language'],
  );
  const completion = await client.complete({
    ref: { type: 'ref/prompt', name: 'validate_course_material' },
    argument: { name: 'course_id', value: 'A' },
  });
  assert.deepEqual(completion.completion.values, ['ADB']);
  const prompt = await client.getPrompt({
    name: 'validate_course_material',
    arguments: {
      course_id: 'ADB',
      document: 'adb-facilitation-plan-de.md',
      document_type: 'facilitation_plan',
      language: 'de',
    },
  });
  const message = prompt.messages[0]?.content;
  assert.ok(message && message.type === 'text' && message.text.includes('check_alignment'));
});
