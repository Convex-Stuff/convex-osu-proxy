import {
  context,
  metrics,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  ValueType,
} from "@opentelemetry/api";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "convex-osu-proxy",
});

const meterProvider = new MeterProvider({
  resource,
  readers: [
    new PeriodicExportingMetricReader({
      // Endpoint comes from OTEL_EXPORTER_OTLP_ENDPOINT (http://alloy:4318 in compose),
      // falls back to http://localhost:4318 for local dev.
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15_000,
    }),
  ],
});

const tracerProvider = new BasicTracerProvider({
  resource,
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});

metrics.setGlobalMeterProvider(meterProvider);
trace.setGlobalTracerProvider(tracerProvider);

const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

const meter = metrics.getMeter("convex-osu-proxy");
const tracer = trace.getTracer("convex-osu-proxy");

const requestCount = meter.createCounter("http.server.request.count", {
  description: "Total HTTP requests handled",
  valueType: ValueType.INT,
});

const requestDuration = meter.createHistogram("http.server.request.duration", {
  description: "HTTP request duration",
  unit: "s",
  advice: {
    explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
});

type RouteHandler = (req: any) => Response | Promise<Response>;

export function instrumentRoutes<T extends Record<string, Record<string, RouteHandler>>>(routes: T): T {
  const instrumented: Record<string, Record<string, RouteHandler>> = {};

  for (const [route, methods] of Object.entries(routes)) {
    instrumented[route] = {};
    for (const [method, handler] of Object.entries(methods)) {
      instrumented[route][method] = async (req) => {
        // Continue a caller's trace if it sent a traceparent header.
        const parentContext = propagation.extract(
          context.active(),
          Object.fromEntries(req.headers ?? []),
        );

        const span = tracer.startSpan(
          `${method} ${route}`,
          {
            kind: SpanKind.SERVER,
            attributes: {
              "http.route": route,
              "http.request.method": method,
            },
          },
          parentContext,
        );

        const start = performance.now();
        let status = 500;
        try {
          const res = await context.with(trace.setSpan(parentContext, span), () =>
            handler(req),
          );
          status = res.status;
          return res;
        } catch (err) {
          span.recordException(err as Error);
          throw err;
        } finally {
          const durationMs = performance.now() - start;
          span.setAttribute("http.response.status_code", status);
          if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();

          const attributes = {
            "http.route": route,
            "http.request.method": method,
            "http.response.status_code": status,
          };
          requestCount.add(1, attributes);
          requestDuration.record(durationMs / 1000, attributes);

          console.log(
            JSON.stringify({
              level: status >= 500 ? "error" : "info",
              msg: "request",
              route,
              method,
              status,
              duration_ms: Math.round(durationMs * 10) / 10,
              trace_id: span.spanContext().traceId,
            }),
          );
        }
      };
    }
  }

  return instrumented as T;
}

// Flush buffered telemetry before the container stops.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    Promise.allSettled([meterProvider.shutdown(), tracerProvider.shutdown()]).finally(() =>
      process.exit(0),
    );
  });
}
