import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { config } from './env';

const initializeTracing = () => {
  const jaegerExporter = new JaegerExporter({
    endpoint: config.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
  });

  const prometheusExporter = new PrometheusExporter({
    port: config.PROMETHEUS_METRICS_PORT || 9464,
    endpoint: '/metrics',
  });

  const sdk = new NodeSDK({
    traceExporter: jaegerExporter,
    metricReader: prometheusExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  
  console.log('OpenTelemetry tracing initialized');
  
  return sdk;
};

export { initializeTracing };
