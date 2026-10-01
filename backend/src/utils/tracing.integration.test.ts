/**
 * Integration tests for OpenTelemetry tracing initialization (#1201).
 * Spans are captured in memory instead of being exported to an OTLP collector.
 */
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { SpanKind } from '@opentelemetry/api';
import { execFileSync } from 'child_process';
import path from 'path';
import { createTraceExporter, initTracing, shutdownTracing, traceAsync } from './tracing';
import { withTracingExtension } from '../tracing/prisma.extension';

jest.setTimeout(20000);

describe('OpenTelemetry tracing (#1201)', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    initTracing({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  });

  afterEach(() => exporter.reset());

  afterAll(async () => {
    await shutdownTracing();
  });

  it('exports spans over OTLP/HTTP by default', () => {
    expect(createTraceExporter().constructor.name).toBe('OTLPTraceExporter');
  });

  it('does not start a second SDK when already initialized', () => {
    const first = initTracing();
    expect(initTracing()).toBe(first);
  });

  it('creates spans for traced operations', async () => {
    await traceAsync('stellar.submitTransaction', async () => 'ok', SpanKind.CLIENT, { 'tx.id': 'abc' });

    const span = exporter.getFinishedSpans().find((s) => s.name === 'stellar.submitTransaction');
    expect(span).toBeDefined();
    expect(span!.kind).toBe(SpanKind.CLIENT);
    expect(span!.attributes['tx.id']).toBe('abc');
  });

  it('creates child spans for Prisma queries', async () => {
    const fakeClient = { $extends: (ext: unknown) => ext };
    const extension = withTracingExtension(fakeClient) as unknown as {
      query: { $allModels: { $allOperations: (p: unknown) => Promise<unknown> } };
    };

    await traceAsync('request', () =>
      extension.query.$allModels.$allOperations({
        model: 'Transaction',
        operation: 'findMany',
        args: {},
        query: async () => [],
      }),
    );

    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === 'request')!;
    const dbSpan = spans.find((s) => s.name === 'prisma:Transaction.findMany');
    expect(dbSpan).toBeDefined();
    expect(dbSpan!.attributes['db.operation']).toBe('findMany');
    expect(dbSpan!.spanContext().traceId).toBe(parent.spanContext().traceId);
  });

  it('creates HTTP server and Express spans for incoming requests', () => {
    // Auto-instrumentation hooks Node's native require, which Jest's module
    // loader bypasses, so this runs a real Express server in a child process.
    const script = `
      const { InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
      const { initTracing, shutdownTracing } = require('./src/utils/tracing');
      const exporter = new InMemorySpanExporter();
      initTracing({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
      const http = require('http');
      const express = require('express');
      const app = express();
      app.get('/ping', (_req, res) => res.send('pong'));
      const server = app.listen(0, () => {
        http.get('http://127.0.0.1:' + server.address().port + '/ping', (res) => {
          res.resume();
          res.on('end', () => setTimeout(async () => {
            const spans = exporter.getFinishedSpans().map((s) => ({
              name: s.name, kind: s.kind, scope: s.instrumentationScope.name,
            }));
            server.close();
            await shutdownTracing();
            process.stdout.write(JSON.stringify(spans));
          }, 50));
        });
      });
    `;
    const output = execFileSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', '-e', script],
      { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' },
    );
    const spans: Array<{ name: string; kind: SpanKind; scope: string }> = JSON.parse(output);

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: SpanKind.SERVER, scope: '@opentelemetry/instrumentation-http' }),
        expect.objectContaining({ kind: SpanKind.CLIENT, scope: '@opentelemetry/instrumentation-http' }),
        expect.objectContaining({ name: 'request handler - /ping', scope: '@opentelemetry/instrumentation-express' }),
      ]),
    );
  });
});
