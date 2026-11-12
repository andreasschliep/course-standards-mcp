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
    'list_learning_objectives',
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
